import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../../src/adapters/cinemasunshine/schedule-client.js";
import {
  type DaySchedule,
  dayScheduleSchema,
  type ScheduleIndex,
  scheduleIndexSchema,
} from "../../src/adapters/cinemasunshine/schedule-schema.js";
import type { Clock } from "../../src/clock.js";
import { parseWatchRuleInput } from "../../src/domain/watch-rule.js";
import { openDatabase } from "../../src/persistence/db.js";
import { WatchRuleRepository } from "../../src/persistence/watch-rule-repository.js";
import {
  type NotificationEvent,
  NotificationService,
  type Notifier,
} from "../../src/services/notification-service.js";
import {
  RuleAlreadyRunningError,
  RuleNotEnabledError,
  RuleNotFoundError,
  type ScheduleSource,
  UnsupportedWatchModeError,
  WatchService,
} from "../../src/services/watch-service.js";
import { readFixtureJson } from "../helpers.js";

const indexFixture = scheduleIndexSchema.parse(readFixtureJson("schedule-index.json"));
const subtitleDay = dayScheduleSchema.parse(readFixtureJson("2852500-020-20260918.json"));

class FakeClock implements Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

function makeSource(
  index: ScheduleIndex,
  days: Record<string, DaySchedule | null>,
  failure?: () => Promise<never>,
): ScheduleSource {
  return {
    async fetchScheduleIndex() {
      if (failure !== undefined) await failure();
      return index;
    },
    async fetchDaySchedule(movieCode, theaterCode, date) {
      return days[`${movieCode}/${theaterCode}/${date}`] ?? null;
    },
  };
}

function makeNotifier(): { events: NotificationEvent[]; notifier: Notifier } {
  const events: NotificationEvent[] = [];
  return {
    events,
    notifier: {
      notify(event: NotificationEvent): Promise<void> {
        events.push(event);
        return Promise.resolve();
      },
    },
  };
}

let lockDir: string;
let database: DatabaseSync;
let repository: WatchRuleRepository;

beforeEach(() => {
  lockDir = mkdtempSync(join(tmpdir(), "cinema-watch-"));
  database = openDatabase(":memory:");
  repository = new WatchRuleRepository(database);
});

afterEach(() => {
  database.close();
  rmSync(lockDir, { recursive: true, force: true });
});

function createRule(id: string, overrides: Record<string, unknown> = {}) {
  const input = parseWatchRuleInput({
    movieTitlePattern: "作品",
    targetDate: "2026-09-29",
    ...overrides,
  });
  return repository.create({ ...input, id });
}

function buildService(
  index: ScheduleIndex,
  days: Record<string, DaySchedule | null>,
  clock: FakeClock,
  notifier: Notifier,
  failure?: () => Promise<never>,
): WatchService {
  return new WatchService({
    repository,
    scheduleSource: makeSource(index, days, failure),
    notifications: new NotificationService(notifier),
    lockDir,
    clock,
    random: () => 0,
  });
}

describe("WatchService polling cadence", () => {
  it("polls every 10 minutes far from the expected sale time", async () => {
    createRule("rule-far");
    const clock = new FakeClock(new Date("2026-09-26T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    const state = await service.runRule("rule-far", { maxTicks: 3 });

    expect(state).toBe("waiting_for_schedule");
    expect(clock.sleeps).toEqual([600_000, 600_000, 600_000]);
    expect(events.map((event) => event.type)).toEqual(["started", "waiting_for_schedule"]);
  });

  it("polls every 30 seconds within 10 minutes of sale", async () => {
    createRule("rule-near");
    const clock = new FakeClock(new Date("2026-09-26T23:55:00+09:00"));
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await service.runRule("rule-near", { maxTicks: 1 });

    expect(clock.sleeps).toEqual([30_000]);
  });

  it("polls every 3 seconds right at the expected time", async () => {
    createRule("rule-due");
    const clock = new FakeClock(new Date("2026-09-27T00:01:00+09:00"));
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await service.runRule("rule-due", { maxTicks: 2 });

    expect(clock.sleeps).toEqual([3_000, 3_000]);
  });

  it("backs off exponentially after rate limiting", async () => {
    createRule("rule-rate");
    const clock = new FakeClock(new Date("2026-09-26T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier, () =>
      Promise.reject(new HttpError(429, "/schedule/data/schedule.json")),
    );

    const state = await service.runRule("rule-rate", { maxTicks: 2 });

    expect(state).toBe("rate_limited");
    expect(clock.sleeps).toEqual([3_000, 6_000]);
    expect(events.map((event) => event.type)).toEqual(["started", "rate_limited"]);
  });
});

describe("WatchService single instance", () => {
  it("rejects a second in-process run of the same rule", async () => {
    createRule("rule-single");
    const clock = new FakeClock(new Date("2026-09-26T00:00:00+09:00"));
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    const controller = new AbortController();
    const first = service.runRule("rule-single", { signal: controller.signal, maxTicks: 100 });
    await expect(service.runRule("rule-single")).rejects.toBeInstanceOf(RuleAlreadyRunningError);
    controller.abort();
    await first;
  });

  it("rejects a second service instance via the file lock", async () => {
    createRule("rule-lock");
    const clock = new FakeClock(new Date("2026-09-26T00:00:00+09:00"));
    const { notifier } = makeNotifier();
    const serviceA = buildService({}, {}, clock, notifier);
    const serviceB = buildService({}, {}, clock, notifier);

    const controller = new AbortController();
    const first = serviceA.runRule("rule-lock", { signal: controller.signal, maxTicks: 100 });
    await expect(serviceB.runRule("rule-lock")).rejects.toBeInstanceOf(RuleAlreadyRunningError);
    controller.abort();
    await first;

    expect(readdirSync(lockDir)).toEqual([]);
  });
});

describe("WatchService notifications", () => {
  it("does not repeat identical state notifications", async () => {
    createRule("rule-dedupe");
    const clock = new FakeClock(new Date("2026-09-26T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await service.runRule("rule-dedupe", { maxTicks: 5 });

    expect(events).toHaveLength(2);
    expect(repository.listEvents("rule-dedupe").map((event) => event.state)).toEqual([
      "created",
      "waiting_for_schedule",
    ]);
  });

  it("notifies once when the target screening is on sale", async () => {
    createRule("rule-open", { movieTitlePattern: "スパイダーマン", targetDate: "2026-09-18" });
    const clock = new FakeClock(new Date("2026-09-17T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = buildService(
      indexFixture,
      { "2852500/020/20260918": subtitleDay },
      clock,
      notifier,
    );

    const state = await service.runRule("rule-open", { maxTicks: 5 });

    expect(state).toBe("ready");
    expect(events.map((event) => event.type)).toEqual(["started", "sales_open"]);
    expect(readdirSync(lockDir)).toEqual([]);
  });
});

describe("WatchService guards", () => {
  it("rejects a missing rule", async () => {
    const clock = new FakeClock(new Date());
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await expect(service.runRule("missing")).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it("rejects a disabled rule", async () => {
    createRule("rule-disabled");
    repository.setEnabled("rule-disabled", false);
    const clock = new FakeClock(new Date());
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await expect(service.runRule("rule-disabled")).rejects.toBeInstanceOf(RuleNotEnabledError);
  });

  it("rejects a mode that is not implemented yet", async () => {
    createRule("rule-hold", { mode: "hold" });
    const clock = new FakeClock(new Date());
    const { notifier } = makeNotifier();
    const service = buildService({}, {}, clock, notifier);

    await expect(service.runRule("rule-hold")).rejects.toBeInstanceOf(UnsupportedWatchModeError);
  });
});

const memberDay = dayScheduleSchema.parse(readFixtureJson("2922223-020-20260929.json"));
const memberIndex: ScheduleIndex = scheduleIndexSchema.parse({
  "2922223": {
    "020": {
      "20260929": {
        "1000": [
          {
            branchCode: "20",
            availabilityStarts: "2026-09-23T00:00:00+0900",
            availabilityStartsToMembers: "2026-09-23T00:00:00+0900",
          },
        ],
      },
    },
  },
});

async function runMemberRule(
  id: string,
  nowIso: string,
  overrides: Record<string, unknown>,
): Promise<{ state: string; events: NotificationEvent[] }> {
  createRule(id, {
    movieTitlePattern: "会员测试作品",
    targetDate: "2026-09-29",
    memberTier: "platinum",
    ...overrides,
  });
  const clock = new FakeClock(new Date(nowIso));
  const { events, notifier } = makeNotifier();
  const service = buildService(memberIndex, { "2922223/020/20260929": memberDay }, clock, notifier);
  const state = await service.runRule(id, { maxTicks: 5 });
  return { state, events };
}

describe("WatchService member sale windows (C-01)", () => {
  it("keeps a PLATINUM rule waiting at 20:29 and opens at 20:30", async () => {
    const before = await runMemberRule("rule-plat-before", "2026-09-26T20:29:00+09:00", {});
    const after = await runMemberRule("rule-plat-after", "2026-09-26T20:30:00+09:00", {});

    expect(before.state).toBe("waiting_for_sale");
    expect(after.state).toBe("ready");
  });

  it("does not open BRONZE/GOLD at the PLATINUM 20:30 window, only at 21:00", async () => {
    const at2030 = await runMemberRule("rule-bronze-2030", "2026-09-26T20:30:00+09:00", {
      memberTier: "bronze",
    });
    const at2100 = await runMemberRule("rule-bronze-2100", "2026-09-26T21:00:00+09:00", {
      memberTier: "gold",
    });

    expect(at2030.state).toBe("waiting_for_sale");
    expect(at2100.state).toBe("ready");
  });

  it("keeps a non-member rule waiting while only the member window is open", async () => {
    const result = await runMemberRule("rule-none-member-window", "2026-09-26T20:35:00+09:00", {
      memberTier: "none",
    });

    expect(result.state).toBe("waiting_for_sale");
  });

  it("honours saleOpensAtOverride for the ready decision", async () => {
    const before = await runMemberRule("rule-override-before", "2026-09-27T08:59:00+09:00", {
      memberTier: "none",
      saleOpensAtOverride: "2026-09-27T09:00:00+09:00",
    });
    const after = await runMemberRule("rule-override-after", "2026-09-27T09:00:00+09:00", {
      memberTier: "none",
      saleOpensAtOverride: "2026-09-27T09:00:00+09:00",
    });

    expect(before.state).toBe("waiting_for_sale");
    expect(after.state).toBe("ready");
  });
});

function rawEntry(options: {
  id: string;
  title: string;
  room: string;
  roomName: string;
  start: string;
  remaining: number;
}): Record<string, unknown> {
  return {
    id: options.id,
    startDate: options.start,
    endDate: "2026-09-18T15:00:00+0900",
    location: { branchCode: options.room, name: { ja: options.roomName } },
    maximumAttendeeCapacity: 100,
    remainingAttendeeCapacity: options.remaining,
    smartTheaterNo: options.id.slice(3, 10),
    name: { ja: options.title, en: "" },
    offers: {
      availabilityStarts: "2026-09-09T00:00:00+0900",
      validFrom: "2026-09-16T00:00:00+0900",
      validThrough: "2026-09-18T04:00:00.000Z",
      availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
      validFromForMembers: "2026-09-15T11:30:00.000Z",
      validThroughForMembers: "2026-09-18T04:00:00.000Z",
      isOnlyWindowSale: false,
    },
    additionalProperty: [],
  };
}

function makeDay(
  items: { time: string; room: string; entry: Record<string, unknown> }[],
): DaySchedule {
  const raw: Record<string, Record<string, unknown>> = {};
  for (const item of items) {
    raw[item.time] = { [item.room]: item.entry };
  }
  return dayScheduleSchema.parse(raw);
}

describe("WatchService schedule refresh and selection (C-02, C-03)", () => {
  it("discovers a matching showtime added for a previously unmatched movie", async () => {
    createRule("rule-refresh", {
      movieTitlePattern: "作品",
      targetDate: "2026-09-18",
      formatIncludes: ["IMAX"],
    });
    const index: ScheduleIndex = scheduleIndexSchema.parse({
      "2840000": {
        "020": {
          "20260918": {
            "1000": [
              {
                branchCode: "10",
                availabilityStarts: "2026-09-09T00:00:00+0900",
                availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
              },
            ],
          },
        },
      },
    });
    const withoutImax = makeDay([
      {
        time: "1000",
        room: "10",
        entry: rawEntry({
          id: "02028400020260918101000",
          title: "作品",
          room: "10",
          roomName: "シアター１",
          start: "2026-09-18T01:00:00.000Z",
          remaining: 50,
        }),
      },
    ]);
    const withImax = makeDay([
      {
        time: "1000",
        room: "10",
        entry: rawEntry({
          id: "02028400020260918101000",
          title: "作品",
          room: "10",
          roomName: "シアター１",
          start: "2026-09-18T01:00:00.000Z",
          remaining: 50,
        }),
      },
      {
        time: "1400",
        room: "50",
        entry: rawEntry({
          id: "02028400020260918501400",
          title: "作品",
          room: "50",
          roomName: "シアター５ IMAX",
          start: "2026-09-18T05:00:00.000Z",
          remaining: 30,
        }),
      },
    ]);

    let call = 0;
    const source: ScheduleSource = {
      fetchScheduleIndex: () => Promise.resolve(index),
      fetchDaySchedule: () => {
        const day = call === 0 ? withoutImax : withImax;
        call += 1;
        return Promise.resolve(day);
      },
    };
    const clock = new FakeClock(new Date("2026-09-17T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = new WatchService({
      repository,
      scheduleSource: source,
      notifications: new NotificationService(notifier),
      lockDir,
      clock,
      random: () => 0,
    });

    const state = await service.runRule("rule-refresh", { maxTicks: 5 });

    expect(call).toBeGreaterThanOrEqual(2);
    expect(state).toBe("ready");
    const open = events.find((event) => event.type === "sales_open");
    expect(open?.type === "sales_open" ? open.screening.performanceId : undefined).toBe(
      "02028400020260918501400",
    );
  });

  it("prefers a later open showtime over an earlier sold-out one", async () => {
    createRule("rule-later-open", {
      movieTitlePattern: "作品",
      targetDate: "2026-09-18",
      startTimeFrom: "15:00",
      startTimeTo: "23:00",
    });
    const index: ScheduleIndex = scheduleIndexSchema.parse({
      "2840000": {
        "020": {
          "20260918": {
            "1800": [
              {
                branchCode: "10",
                availabilityStarts: "2026-09-09T00:00:00+0900",
                availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
              },
            ],
            "2100": [
              {
                branchCode: "10",
                availabilityStarts: "2026-09-09T00:00:00+0900",
                availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
              },
            ],
          },
        },
      },
    });
    const day = makeDay([
      {
        time: "1800",
        room: "10",
        entry: rawEntry({
          id: "02028400020260918101800",
          title: "作品",
          room: "10",
          roomName: "シアター１",
          start: "2026-09-18T09:00:00.000Z",
          remaining: 0,
        }),
      },
      {
        time: "2100",
        room: "10",
        entry: rawEntry({
          id: "02028400020260918102100",
          title: "作品",
          room: "10",
          roomName: "シアター１",
          start: "2026-09-18T12:00:00.000Z",
          remaining: 50,
        }),
      },
    ]);
    const clock = new FakeClock(new Date("2026-09-17T00:00:00+09:00"));
    const { events, notifier } = makeNotifier();
    const service = buildService(index, { "2840000/020/20260918": day }, clock, notifier);

    const state = await service.runRule("rule-later-open", { maxTicks: 5 });

    expect(state).toBe("ready");
    const open = events.find((event) => event.type === "sales_open");
    expect(open?.type === "sales_open" ? open.screening.performanceId : undefined).toBe(
      "02028400020260918102100",
    );
  });
});
