import type { PurchaseMeta } from "../adapters/cinemasunshine/purchase-meta.js";
import type { ScreenSide, SeatLegendEntry } from "../adapters/cinemasunshine/seat-map.js";
import { labelsMatch, normalizeSeatToken } from "../adapters/cinemasunshine/seat-map.js";
import type { Screening } from "../domain/screening.js";
import { filterScreenings } from "../domain/screening.js";
import type { Seat, SeatGroup } from "../domain/seat.js";
import { formatsMatch, parseTitle, titlesMatchCore } from "../domain/title.js";
import type { WatchRule } from "../domain/watch-rule.js";
import { rankSeatGroups, type SeatRankingOptions } from "./seat-ranking-service.js";

export type AssistOutcomeState =
  | "user_action_required"
  | "no_match"
  | "sold_out"
  | "login_required"
  | "session_expired"
  | "congested"
  | "duplicate_transaction"
  | "site_changed"
  | "error";

export type AssistOutcome = {
  state: AssistOutcomeState;
  group?: SeatGroup;
  alternatives?: SeatGroup[];
  reasons?: string[];
};

export type ScreeningVerification = {
  matches: boolean;
  reasons: string[];
};

export function verifyScreeningMatchesRule(
  rule: WatchRule,
  screening: Screening,
): ScreeningVerification {
  const reasons: string[] = [];
  if (screening.theaterCode !== rule.theaterCode) {
    reasons.push(`theater ${screening.theaterCode} != ${rule.theaterCode}`);
  }

  const matched = filterScreenings([screening], {
    targetDate: rule.targetDate,
    titlePattern: rule.movieTitlePattern,
    formatIncludes: rule.formatIncludes,
    formatExcludes: rule.formatExcludes,
    ...(rule.startTimeFrom !== undefined ? { startTimeFrom: rule.startTimeFrom } : {}),
    ...(rule.startTimeTo !== undefined ? { startTimeTo: rule.startTimeTo } : {}),
  });

  if (matched.length !== 1) {
    reasons.push("screening does not match rule title/date/format/time filters");
  }
  return { matches: reasons.length === 0, reasons };
}

export function verifyPurchaseMeta(
  rule: WatchRule,
  screening: Screening,
  meta: PurchaseMeta | undefined,
): ScreeningVerification {
  if (meta === undefined) {
    return { matches: false, reasons: ["purchase page metadata not found"] };
  }

  const reasons: string[] = [];
  const expectedDate = screening.startsAt.slice(0, 10);
  const expectedTime = screening.startsAt.slice(11, 16);

  if (!titlesMatchCore(meta.title, screening.movieTitle)) {
    reasons.push(
      `title core "${parseTitle(meta.title).core}" != "${parseTitle(screening.movieTitle).core}"`,
    );
  } else if (!formatsMatch(meta.title, screening.movieTitle)) {
    reasons.push(
      `formats [${parseTitle(meta.title).formats.join(",")}] != [${parseTitle(screening.movieTitle).formats.join(",")}]`,
    );
  }
  if (meta.date !== expectedDate) {
    reasons.push(`date "${meta.date ?? ""}" != "${expectedDate}"`);
  }
  if (meta.startTime !== expectedTime) {
    reasons.push(`startTime "${meta.startTime ?? ""}" != "${expectedTime}"`);
  }
  if (meta.screenName !== screening.screenName) {
    reasons.push(`screen "${meta.screenName}" != "${screening.screenName}"`);
  }
  if (rule.theaterCode === "020" && !meta.theaterName.includes("グランドシネマサンシャイン")) {
    reasons.push(`unexpected theater "${meta.theaterName}"`);
  }
  if (meta.performanceIdFromUrl === undefined) {
    reasons.push("performanceId missing on purchase page");
  } else if (meta.performanceIdFromUrl !== screening.performanceId) {
    reasons.push(`performanceId "${meta.performanceIdFromUrl}" != "${screening.performanceId}"`);
  }

  return { matches: reasons.length === 0, reasons };
}

export function rankingOptionsFromRule(
  rule: WatchRule,
  screenSide: "top" | "bottom",
  screenGeometry: { centerX?: number; width?: number } = {},
): SeatRankingOptions {
  return {
    ticketCount: rule.ticketCount,
    requireAdjacent: rule.requireAdjacent,
    allowedSeatTypes: rule.allowedSeatTypes,
    excludedSeatTypes: rule.excludedSeatTypes,
    maxSurchargeYen: rule.maxSurchargeYen,
    aislePreference: rule.aislePreference,
    screenSide,
    ...(screenGeometry.centerX !== undefined ? { screenCenterX: screenGeometry.centerX } : {}),
    ...(screenGeometry.width !== undefined ? { screenWidth: screenGeometry.width } : {}),
    ...(rule.preferredRows !== undefined ? { preferredRows: rule.preferredRows } : {}),
    ...(rule.excludedRows !== undefined ? { excludedRows: rule.excludedRows } : {}),
    ...(rule.preferredSeatNumbers !== undefined
      ? { preferredSeatNumbers: rule.preferredSeatNumbers }
      : {}),
  };
}

export type AssistSeatMapResult = {
  state:
    | "ready"
    | "login_required"
    | "session_expired"
    | "congested"
    | "duplicate_transaction"
    | "error"
    | "site_changed";
  seats: Seat[];
  legend: SeatLegendEntry[];
  screenSide: ScreenSide;
  screenCenterX?: number;
  screenWidth?: number;
  meta?: PurchaseMeta;
  diagnostics?: string;
};

export type SeatAssistDeps = {
  openSeatMap(performanceId: string): Promise<AssistSeatMapResult>;
  highlight(seats: readonly Seat[]): Promise<string[]>;
};

const PASSIVE_STATE_MAP: Record<
  Exclude<AssistSeatMapResult["state"], "ready" | "site_changed">,
  AssistOutcomeState
> = {
  login_required: "login_required",
  session_expired: "session_expired",
  congested: "congested",
  duplicate_transaction: "duplicate_transaction",
  error: "error",
};

export class SeatAssistService {
  constructor(private readonly deps: SeatAssistDeps) {}

  async assist(rule: WatchRule, screening: Screening): Promise<AssistOutcome> {
    const verification = verifyScreeningMatchesRule(rule, screening);
    if (!verification.matches) {
      return { state: "no_match", reasons: verification.reasons };
    }

    const map = await this.deps.openSeatMap(screening.performanceId);
    if (map.state !== "ready") {
      if (map.state === "site_changed") {
        return {
          state: "site_changed",
          ...(map.diagnostics !== undefined ? { reasons: [map.diagnostics] } : {}),
        };
      }
      return { state: PASSIVE_STATE_MAP[map.state] };
    }

    const metaVerification = verifyPurchaseMeta(rule, screening, map.meta);
    if (!metaVerification.matches) {
      return { state: "no_match", reasons: metaVerification.reasons };
    }

    if (map.screenSide === "unknown") {
      return { state: "site_changed", reasons: ["screen direction unknown"] };
    }

    const groups = rankSeatGroups(
      map.seats,
      rankingOptionsFromRule(rule, map.screenSide, {
        ...(map.screenCenterX !== undefined ? { centerX: map.screenCenterX } : {}),
        ...(map.screenWidth !== undefined ? { width: map.screenWidth } : {}),
      }),
    );
    const [best, ...alternatives] = groups;
    if (best === undefined) {
      return { state: "sold_out", reasons: ["no seat group satisfies the rule"] };
    }

    const recommended = best.seats.map((seat) => normalizeSeatToken(`${seat.row}${seat.number}`));
    const matched = await this.deps.highlight(best.seats);
    if (!labelsMatch(recommended, matched)) {
      return {
        state: "site_changed",
        reasons: [`highlight mismatch: expected ${recommended.join(",")} got ${matched.join(",")}`],
      };
    }

    return {
      state: "user_action_required",
      group: best,
      alternatives: alternatives.slice(0, 2),
    };
  }
}
