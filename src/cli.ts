import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { ScheduleClient } from "./adapters/cinemasunshine/schedule-client.js";
import { type AppConfig, describeConfig, loadConfig } from "./config.js";
import { parseWatchRuleInput, type WatchRule } from "./domain/watch-rule.js";
import { createLogger } from "./logger.js";
import { createConsoleNotifier } from "./notifications/console.js";
import { openDatabase } from "./persistence/db.js";
import { WatchRuleRepository } from "./persistence/watch-rule-repository.js";
import { NotificationService } from "./services/notification-service.js";
import { expectedSaleOpensAtForRule } from "./services/sale-time-service.js";
import { WatchService } from "./services/watch-service.js";

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
  --mode <notify>        notify (assist/hold arrive in a later phase)
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
  const controller = new AbortController();
  const onSignal = (): void => {
    process.stdout.write("\nCancelling...\n");
    controller.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const notifications = new NotificationService(createConsoleNotifier());
  const service = new WatchService({
    repository: context.repository,
    scheduleSource: context.scheduleClient,
    notifications,
    lockDir: join(dirname(context.config.dbPath), "locks"),
    logger,
  });

  const state = await service.runRule(id, { signal: controller.signal });
  process.stdout.write(`Watch finished: ${state}\n`);
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
