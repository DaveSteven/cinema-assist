import { HttpError } from "../adapters/cinemasunshine/schedule-client.js";
import {
  listMovieCodesForTheaterDate,
  normalizeDaySchedule,
} from "../adapters/cinemasunshine/schedule-normalizer.js";
import type { DaySchedule, ScheduleIndex } from "../adapters/cinemasunshine/schedule-schema.js";
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type { SalesAudience, SalesStatus, Screening } from "../domain/screening.js";
import { filterScreenings, sortScreeningsByStart } from "../domain/screening.js";
import type { WatchRule } from "../domain/watch-rule.js";
import type { Logger } from "../logger.js";
import { silentLogger } from "../logger.js";
import type { WatchRuleRepository } from "../persistence/watch-rule-repository.js";
import type { NotificationEvent, NotificationService } from "./notification-service.js";
import {
  backoffWithJitter,
  expectedSaleOpensAtForRule,
  pollSchedule,
} from "./sale-time-service.js";
import { acquireSingleInstanceLock, LockError, type LockHandle } from "./single-instance-lock.js";

export type ScheduleSource = {
  fetchScheduleIndex(): Promise<ScheduleIndex>;
  fetchDaySchedule(
    movieCode: string,
    theaterCode: string,
    date: string,
  ): Promise<DaySchedule | null>;
};

export type WatchState =
  | "created"
  | "waiting_for_schedule"
  | "waiting_for_sale"
  | "ready"
  | "sold_out"
  | "no_match"
  | "rate_limited"
  | "error"
  | "cancelled";

type ScanState = "waiting_for_schedule" | "waiting_for_sale" | "ready" | "sold_out" | "no_match";

type ScanResult = {
  state: ScanState;
  screenings: Screening[];
  target?: Screening;
  reason?: string;
};

export class RuleNotFoundError extends Error {
  constructor(ruleId: string) {
    super(`Watch rule not found: ${ruleId}`);
    this.name = "RuleNotFoundError";
  }
}

export class RuleNotEnabledError extends Error {
  constructor(ruleId: string) {
    super(`Watch rule is disabled: ${ruleId}`);
    this.name = "RuleNotEnabledError";
  }
}

export class RuleAlreadyRunningError extends Error {
  constructor(ruleId: string) {
    super(`Watch rule is already running: ${ruleId}`);
    this.name = "RuleAlreadyRunningError";
  }
}

export class UnsupportedWatchModeError extends Error {
  constructor(mode: string) {
    super(`Mode "${mode}" is not implemented yet; use mode "notify"`);
    this.name = "UnsupportedWatchModeError";
  }
}

function gateSalesStatus(status: SalesStatus, now: Date, opensAt: string): SalesStatus {
  if (status === "ended" || status === "not_open") {
    return status;
  }
  const opensAtMs = Date.parse(opensAt);
  if (!Number.isNaN(opensAtMs) && now.getTime() < opensAtMs) {
    return "not_open";
  }
  return status;
}

export type RunRuleOptions = {
  signal?: AbortSignal;
  maxTicks?: number;
};

export type WatchServiceOptions = {
  repository: WatchRuleRepository;
  scheduleSource: ScheduleSource;
  notifications: NotificationService;
  lockDir: string;
  clock?: Clock;
  logger?: Logger;
  maxDayFetches?: number;
  random?: () => number;
};

export class WatchService {
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly maxDayFetches: number;
  private readonly random: () => number;
  private readonly active = new Set<string>();

  constructor(private readonly options: WatchServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? silentLogger;
    this.maxDayFetches = options.maxDayFetches ?? 40;
    this.random = options.random ?? Math.random;
  }

  async runRule(ruleId: string, runOptions: RunRuleOptions = {}): Promise<WatchState> {
    const rule = this.options.repository.get(ruleId);
    if (rule === undefined) throw new RuleNotFoundError(ruleId);
    if (!rule.enabled) throw new RuleNotEnabledError(ruleId);
    if (rule.mode !== "notify") throw new UnsupportedWatchModeError(rule.mode);
    if (this.active.has(ruleId)) throw new RuleAlreadyRunningError(ruleId);

    this.active.add(ruleId);
    let lock: LockHandle;
    try {
      lock = acquireSingleInstanceLock(this.options.lockDir, ruleId);
    } catch (error) {
      this.active.delete(ruleId);
      if (error instanceof LockError) throw new RuleAlreadyRunningError(ruleId);
      throw error;
    }

    try {
      return await this.runLoop(rule, runOptions);
    } finally {
      this.active.delete(ruleId);
      lock.release();
    }
  }

  private async runLoop(rule: WatchRule, runOptions: RunRuleOptions): Promise<WatchState> {
    const expectedSaleOpensAt = expectedSaleOpensAtForRule(rule);
    let consecutiveErrors = 0;
    let ticks = 0;
    let lastState: WatchState = "created";

    await this.enterState(rule, "created", { expectedSaleOpensAt });
    this.logger.info({ ruleId: rule.id, expectedSaleOpensAt }, "watch started");

    while (!runOptions.signal?.aborted) {
      let intervalMs: number;
      try {
        const result = await this.scan(rule, this.clock.now());
        consecutiveErrors = 0;
        lastState = result.state;
        await this.enterState(rule, result.state, {
          ...(result.target !== undefined ? { target: result.target } : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
          expectedSaleOpensAt,
        });

        if (
          result.state === "ready" ||
          result.state === "sold_out" ||
          result.state === "no_match"
        ) {
          this.logger.info({ ruleId: rule.id, state: result.state }, "watch finished");
          return result.state;
        }
        intervalMs = pollSchedule(expectedSaleOpensAt, this.clock.now()).intervalMs;
      } catch (error) {
        consecutiveErrors += 1;
        const status = error instanceof HttpError ? error.status : undefined;
        const rateLimited = status === 429 || status === 403;
        lastState = rateLimited ? "rate_limited" : "error";
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({ ruleId: rule.id, status, err: message }, "watch poll failed");
        await this.enterState(rule, lastState, { reason: message });
        intervalMs = backoffWithJitter(consecutiveErrors, { random: this.random });
      }

      await this.clock.sleep(intervalMs, runOptions.signal);

      ticks += 1;
      if (runOptions.maxTicks !== undefined && ticks >= runOptions.maxTicks) {
        return lastState;
      }
    }

    await this.enterState(rule, "cancelled");
    return "cancelled";
  }

  private async scan(rule: WatchRule, now: Date): Promise<ScanResult> {
    const index = await this.options.scheduleSource.fetchScheduleIndex();
    const compactDate = rule.targetDate.replaceAll("-", "");
    const movieCodes = listMovieCodesForTheaterDate(index, rule.theaterCode, compactDate);
    if (movieCodes.length === 0) {
      return { state: "waiting_for_schedule", screenings: [] };
    }

    const audience: SalesAudience = rule.memberTier === "none" ? "public" : "member";
    const opensAt = expectedSaleOpensAtForRule(rule);
    const matches: Screening[] = [];
    let fetched = 0;
    for (const movieCode of movieCodes) {
      if (fetched >= this.maxDayFetches) break;

      const day = await this.options.scheduleSource.fetchDaySchedule(
        movieCode,
        rule.theaterCode,
        compactDate,
      );
      fetched += 1;
      if (day === null) continue;

      const normalized = normalizeDaySchedule(day, {
        movieCode,
        theaterCode: rule.theaterCode,
        now,
        audience,
      });
      matches.push(
        ...filterScreenings(normalized, {
          targetDate: rule.targetDate,
          titlePattern: rule.movieTitlePattern,
          formatIncludes: rule.formatIncludes,
          formatExcludes: rule.formatExcludes,
          ...(rule.startTimeFrom !== undefined ? { startTimeFrom: rule.startTimeFrom } : {}),
          ...(rule.startTimeTo !== undefined ? { startTimeTo: rule.startTimeTo } : {}),
        }),
      );
    }

    if (matches.length === 0) {
      return { state: "waiting_for_schedule", screenings: [] };
    }

    const gated = sortScreeningsByStart(matches).map((screening) => {
      const salesStatus = gateSalesStatus(screening.salesStatus, now, opensAt);
      return salesStatus === screening.salesStatus ? screening : { ...screening, salesStatus };
    });

    const buyable = gated.find(
      (screening) => screening.salesStatus === "open" || screening.salesStatus === "few",
    );
    if (buyable !== undefined) {
      return { state: "ready", screenings: gated, target: buyable };
    }

    const waiting = gated.find((screening) => screening.salesStatus === "not_open");
    if (waiting !== undefined) {
      return { state: "waiting_for_sale", screenings: gated, target: waiting };
    }

    const hasSoldOut = gated.some((screening) => screening.salesStatus === "sold_out");
    return {
      state: hasSoldOut ? "sold_out" : "no_match",
      screenings: gated,
      target: gated[0],
      reason: hasSoldOut ? undefined : "目标场次已结束",
    };
  }

  private async enterState(
    rule: WatchRule,
    state: WatchState,
    options: { target?: Screening; reason?: string; expectedSaleOpensAt?: string } = {},
  ): Promise<void> {
    const current = this.options.repository.getRuntimeState(rule.id);
    if (current?.lastState !== state) {
      this.options.repository.appendEvent({
        ruleId: rule.id,
        state,
        ...(options.target !== undefined ? { performanceId: options.target.performanceId } : {}),
        ...(options.reason !== undefined ? { detail: options.reason } : {}),
      });
      this.options.repository.setRuntimeState(rule.id, { lastState: state });
    }

    const event = this.buildEvent(state, rule, options);
    if (event === undefined) return;
    const key = `${rule.id}:${state}:${options.target?.performanceId ?? ""}`;
    if (this.options.repository.getRuntimeState(rule.id)?.lastNotificationKey === key) return;

    const sent = await this.options.notifications.notify(key, event);
    if (sent) {
      this.options.repository.setRuntimeState(rule.id, { lastNotificationKey: key });
    }
  }

  private buildEvent(
    state: WatchState,
    rule: WatchRule,
    options: { target?: Screening; reason?: string; expectedSaleOpensAt?: string },
  ): NotificationEvent | undefined {
    switch (state) {
      case "created":
        return { type: "started", rule, expectedSaleOpensAt: options.expectedSaleOpensAt ?? "" };
      case "waiting_for_schedule":
        return { type: "waiting_for_schedule", rule };
      case "waiting_for_sale":
        return options.target === undefined
          ? undefined
          : {
              type: "waiting_for_sale",
              rule,
              screening: options.target,
              expectedSaleOpensAt: options.expectedSaleOpensAt ?? "",
            };
      case "ready":
        return options.target === undefined
          ? undefined
          : { type: "sales_open", rule, screening: options.target };
      case "sold_out":
        return options.target === undefined
          ? undefined
          : { type: "sold_out", rule, screening: options.target };
      case "no_match":
        return {
          type: "no_match",
          rule,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
        };
      case "rate_limited":
        return { type: "rate_limited", rule, message: options.reason ?? "" };
      case "error":
        return { type: "error", rule, message: options.reason ?? "" };
      case "cancelled":
        return { type: "cancelled", rule };
    }
  }
}
