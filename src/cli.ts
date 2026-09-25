import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import type { BrowserContext, Frame } from "playwright";
import { AssistPageClosedError, openAssistPage } from "./adapters/cinemasunshine/assist-page.js";
import { checkLogin, launchPersistentContext } from "./adapters/cinemasunshine/browser-session.js";
import {
  parsePerformanceIdFromUrl,
  readPurchaseMeta,
} from "./adapters/cinemasunshine/purchase-meta.js";
import { PurchasePage } from "./adapters/cinemasunshine/purchase-page.js";
import { ScheduleClient } from "./adapters/cinemasunshine/schedule-client.js";
import {
  captureSeatState,
  captureTheaterLayout,
  highlightSeats,
  requireSeatState,
  type SeatStateInfo,
  waitForSeatMap,
  waitForSeatPage,
} from "./adapters/cinemasunshine/seat-map.js";
import { type AppConfig, describeConfig, loadConfig } from "./config.js";
import type { Screening } from "./domain/screening.js";
import { parseWatchRuleInput, type WatchRule } from "./domain/watch-rule.js";
import { createLogger } from "./logger.js";
import { createConsoleNotifier } from "./notifications/console.js";
import { openDatabase } from "./persistence/db.js";
import { WatchRuleRepository } from "./persistence/watch-rule-repository.js";
import { NotificationService } from "./services/notification-service.js";
import { expectedSaleOpensAtForRule } from "./services/sale-time-service.js";
import { type AssistOutcome, SeatAssistService } from "./services/seat-assist-service.js";
import { isFailureWatchState, WatchService } from "./services/watch-service.js";

dotenv.config({ quiet: true });

const USAGE = `cinema-assist

Usage:
  npm run cli -- config
  npm run cli -- watch add --title <pattern> --date <YYYY-MM-DD> [options]
  npm run cli -- watch list
  npm run cli -- watch enable <id>
  npm run cli -- watch disable <id>
  npm run cli -- watch remove <id>
  npm run cli -- watch run <id>

watch add options:
  --title <regex>        Movie title pattern (required)
  --date <YYYY-MM-DD>    Target date in Asia/Tokyo (required)
  --from <HH:mm>         Earliest start time
  --to <HH:mm>           Latest start time
  --include <fmt>        Required format label (repeatable / comma separated)
  --exclude <fmt>        Excluded format label (repeatable / comma separated)
  --tickets <1-6>        Number of tickets (default 1)
  --adjacent <bool>      Require adjacent seats (default true)
  --mode <notify|assist> notify | assist (hold is not available yet)
  --member <tier>        platinum | bronze | gold | none (default none)
  --sale-at <iso>        Override the expected sale opening time
  --seat-type <type>     Allowed seat type (repeatable / comma separated, default standard)
  --exclude-seat-type <type>  Excluded seat type (repeatable / comma separated)
  --max-surcharge <yen>  Maximum surcharge per seat in yen (default 0)

Monitoring is low frequency and never purchases automatically.`;

const PARSE_OPTIONS = {
  title: { type: "string" },
  date: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  include: { type: "string", multiple: true },
  exclude: { type: "string", multiple: true },
  tickets: { type: "string" },
  adjacent: { type: "string" },
  mode: { type: "string" },
  member: { type: "string" },
  "sale-at": { type: "string" },
  "seat-type": { type: "string", multiple: true },
  "exclude-seat-type": { type: "string", multiple: true },
  "max-surcharge": { type: "string" },
  theater: { type: "string" },
} as const;

type Ctx = {
  config: AppConfig;
  repository: WatchRuleRepository;
  scheduleClient: ScheduleClient;
};

function openContext(): Ctx {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  return {
    config,
    repository: new WatchRuleRepository(db),
    scheduleClient: new ScheduleClient({ userAgent: "cinema-assist/0.1 (local watch)" }),
  };
}

function splitList(values: string[] | undefined): string[] | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function parseTickets(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--tickets must be an integer, received "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer, received "${value}"`);
  }
  return parsed;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean value, received "${value}"`);
}

function printRule(rule: WatchRule): void {
  process.stdout.write(
    `${[
      rule.id,
      `  enabled:      ${rule.enabled}`,
      `  mode:         ${rule.mode}`,
      `  target:       ${rule.targetDate}  ${rule.movieTitlePattern}`,
      `  memberTier:   ${rule.memberTier}`,
      `  seatTypes:    ${rule.allowedSeatTypes.join(", ")} (max surcharge ¥${rule.maxSurchargeYen})`,
      `  expectedOpen: ${expectedSaleOpensAtForRule(rule)}`,
    ].join("\n")}\n`,
  );
}

function commandWatchAdd(rest: string[]): void {
  const { values } = parseArgs({ args: rest, options: PARSE_OPTIONS, allowPositionals: false });
  const title = values.title;
  const date = values.date;
  if (title === undefined || date === undefined) {
    throw new Error("watch add requires --title and --date");
  }

  const context = openContext();
  const input = parseWatchRuleInput({
    theaterCode: values.theater ?? "020",
    movieTitlePattern: title,
    targetDate: date,
    formatIncludes: splitList(values.include) ?? [],
    formatExcludes: splitList(values.exclude) ?? [],
    ...(values.from !== undefined ? { startTimeFrom: values.from } : {}),
    ...(values.to !== undefined ? { startTimeTo: values.to } : {}),
    ...(values.tickets !== undefined ? { ticketCount: parseTickets(values.tickets) } : {}),
    requireAdjacent: parseBooleanFlag(values.adjacent, true),
    ...(values.mode !== undefined ? { mode: values.mode } : {}),
    ...(values.member !== undefined ? { memberTier: values.member } : {}),
    ...(values["sale-at"] !== undefined ? { saleOpensAtOverride: values["sale-at"] } : {}),
    ...(values["seat-type"] !== undefined
      ? { allowedSeatTypes: splitList(values["seat-type"]) }
      : {}),
    ...(values["exclude-seat-type"] !== undefined
      ? { excludedSeatTypes: splitList(values["exclude-seat-type"]) }
      : {}),
    ...(values["max-surcharge"] !== undefined
      ? { maxSurchargeYen: parseNonNegativeInt(values["max-surcharge"], "--max-surcharge") }
      : {}),
  });

  const created = context.repository.create({ ...input, id: randomUUID() });
  process.stdout.write("Created watch rule:\n");
  printRule(created);
}

function commandWatchList(): void {
  const context = openContext();
  const rules = context.repository.list();
  if (rules.length === 0) {
    process.stdout.write("No watch rules.\n");
    return;
  }
  for (const rule of rules) {
    printRule(rule);
  }
}

function commandWatchSetEnabled(id: string, enabled: boolean): void {
  const context = openContext();
  const changed = context.repository.setEnabled(id, enabled);
  if (!changed) {
    throw new Error(`Watch rule not found: ${id}`);
  }
  process.stdout.write(`${enabled ? "Enabled" : "Disabled"} ${id}\n`);
}

function commandWatchRemove(id: string): void {
  const context = openContext();
  if (!context.repository.remove(id)) {
    throw new Error(`Watch rule not found: ${id}`);
  }
  process.stdout.write(`Removed ${id}\n`);
}

async function commandWatchRun(id: string): Promise<void> {
  const context = openContext();
  const logger = createLogger(context.config.logLevel);
  const rule = context.repository.get(id);
  if (rule === undefined) throw new Error(`Watch rule not found: ${id}`);

  const notifications = new NotificationService(createConsoleNotifier());
  const controller = new AbortController();
  const onSignal = (): void => {
    process.stdout.write("\nCancelling...\n");
    controller.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let browserContext: BrowserContext | undefined;
  let seatAssist: ((rule: WatchRule, screening: Screening) => Promise<AssistOutcome>) | undefined;

  if (rule.mode === "assist") {
    browserContext = await launchPersistentContext({
      profileDir: context.config.browserProfileDir,
      headless: false,
      channel: context.config.browserChannel,
    });
    const login = await checkLogin(browserContext);
    if (!login.loggedIn) {
      process.stdout.write(`未登录（${login.status}），请先运行 npm run login\n`);
      await browserContext.close();
      process.exitCode = 1;
      return;
    }

    const page = await openAssistPage(browserContext);
    const assistService = new SeatAssistService({
      openSeatMap: async (performanceId) => {
        if (page.isClosed()) throw new AssistPageClosedError();
        await page.bringToFront().catch(() => {});

        let capturedPerformanceId: string | undefined;
        const onNavigated = (frame: Frame): void => {
          const id = parsePerformanceIdFromUrl(frame.url());
          if (id !== undefined) capturedPerformanceId = id;
        };
        page.on("framenavigated", onNavigated);

        try {
          const capture = captureSeatState(page);
          const layoutCapture = captureTheaterLayout(page);
          const purchase = new PurchasePage(page, { preflightLogin: false });
          const inspection = await purchase.openPurchase(performanceId);
          if (inspection.state !== "ready") {
            return { state: inspection.state, seats: [], legend: [], screenSide: "unknown" };
          }

          if (!(await waitForSeatPage(page, { timeoutMs: 15_000 }))) {
            return {
              state: "site_changed",
              seats: [],
              legend: [],
              screenSide: "unknown",
              diagnostics: `seat page not ready url=${page.url()}`,
            };
          }

          let seatState: SeatStateInfo;
          try {
            seatState = requireSeatState(await capture.waitForSeatState(20_000));
          } catch {
            return {
              state: "site_changed",
              seats: [],
              legend: [],
              screenSide: "unknown",
              diagnostics: `seat state unavailable url=${page.url()}`,
            };
          }

          const ready = await waitForSeatMap(page, seatState, { timeoutMs: 20_000, pollMs: 500 });
          if (ready.status !== "ready") {
            return {
              state: "site_changed",
              seats: [],
              legend: [],
              screenSide: "unknown",
              diagnostics: `seat map timeout url=${ready.url ?? page.url()} domSeats=${
                ready.domSeatElementCount ?? "-"
              } parsedDom=${ready.parsedDomSeatCount ?? "-"} available=${
                ready.availableCount ?? "-"
              } apiFree=${ready.apiFreeCount ?? "-"} mappedApiFree=${
                ready.mappedApiFree ?? "-"
              } unmappableFree=${ready.unmappableFree ?? "-"} duplicateFreeKeys=${
                ready.duplicateFreeKeys ?? "-"
              } expected=${ready.expectedAvailableCount ?? "-"}`,
            };
          }

          const layout = await layoutCapture.waitForScreenSide(5_000);
          const meta = await readPurchaseMeta(page, { performanceId: capturedPerformanceId });
          return {
            state: "ready",
            seats: ready.seats,
            legend: ready.legend,
            screenSide: layout.screenSide !== "unknown" ? layout.screenSide : ready.screenSide,
            ...(ready.screenCenterX !== undefined ? { screenCenterX: ready.screenCenterX } : {}),
            ...(ready.screenWidth !== undefined ? { screenWidth: ready.screenWidth } : {}),
            ...(meta !== undefined ? { meta } : {}),
          };
        } finally {
          page.off("framenavigated", onNavigated);
        }
      },
      highlight: (seats) => highlightSeats(page, seats),
    });
    seatAssist = (selectedRule, screening) => assistService.assist(selectedRule, screening);
  }

  const service = new WatchService({
    repository: context.repository,
    scheduleSource: context.scheduleClient,
    notifications,
    lockDir: join(dirname(context.config.dbPath), "locks"),
    logger,
    ...(seatAssist !== undefined ? { seatAssist } : {}),
  });

  try {
    const state = await service.runRule(id, { signal: controller.signal });
    process.stdout.write(`Watch finished: ${state}\n`);
    if (isFailureWatchState(state)) {
      process.exitCode = 1;
    }

    if (
      rule.mode === "assist" &&
      state === "user_action_required" &&
      browserContext !== undefined
    ) {
      process.stdout.write(
        "浏览器已保留推荐座位高亮；请在窗口中手动选座并继续。按 Ctrl+C 结束程序（本工具不会自动锁座或付款）。\n",
      );
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
        browserContext?.once("close", done);
      });
    }
  } finally {
    if (browserContext !== undefined) {
      await browserContext.close().catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [group, subcommand, ...rest] = argv;

  if (group === "config") {
    const config = loadConfig();
    process.stdout.write(`${JSON.stringify(describeConfig(config), null, 2)}\n`);
    return;
  }

  if (group === "watch") {
    switch (subcommand) {
      case "add":
        commandWatchAdd(rest);
        return;
      case "list":
        commandWatchList();
        return;
      case "enable":
      case "disable": {
        const id = rest[0];
        if (id === undefined) throw new Error(`watch ${subcommand} requires an id`);
        commandWatchSetEnabled(id, subcommand === "enable");
        return;
      }
      case "remove": {
        const id = rest[0];
        if (id === undefined) throw new Error("watch remove requires an id");
        commandWatchRemove(id);
        return;
      }
      case "run": {
        const id = rest[0];
        if (id === undefined) throw new Error("watch run requires an id");
        await commandWatchRun(id);
        return;
      }
      default:
        process.stdout.write(`${USAGE}\n`);
        return;
    }
  }

  process.stdout.write(`${USAGE}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
