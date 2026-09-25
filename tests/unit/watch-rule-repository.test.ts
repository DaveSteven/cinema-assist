import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWatchRuleInput } from "../../src/domain/watch-rule.js";
import { openDatabase } from "../../src/persistence/db.js";
import { WatchRuleRepository } from "../../src/persistence/watch-rule-repository.js";

let db: DatabaseSync;
let repository: WatchRuleRepository;

beforeEach(() => {
  db = openDatabase(":memory:");
  repository = new WatchRuleRepository(db);
});

afterEach(() => {
  db.close();
});

function makeInput(overrides: Record<string, unknown> = {}) {
  return parseWatchRuleInput({
    movieTitlePattern: "作品",
    targetDate: "2026-09-29",
    ...overrides,
  });
}

describe("WatchRuleRepository", () => {
  it("creates and reads back a rule with defaults", () => {
    const created = repository.create({ ...makeInput(), id: "rule-1" });

    expect(created.id).toBe("rule-1");
    expect(created.enabled).toBe(true);
    expect(created.mode).toBe("notify");
    expect(repository.get("rule-1")).toEqual(created);
  });

  it("round-trips optional arrays and fields", () => {
    const input = makeInput({
      formatIncludes: ["IMAX", "字幕"],
      formatExcludes: ["吹替"],
      preferredRows: ["H", "I"],
      excludedRows: ["A"],
      preferredSeatNumbers: [5, 6],
      startTimeFrom: "10:00",
      startTimeTo: "18:00",
      memberTier: "platinum",
      saleOpensAtOverride: "2026-09-27T20:30:00+09:00",
    });
    repository.create({ ...input, id: "rule-2" });

    expect(repository.get("rule-2")).toMatchObject({
      formatIncludes: ["IMAX", "字幕"],
      formatExcludes: ["吹替"],
      preferredRows: ["H", "I"],
      excludedRows: ["A"],
      preferredSeatNumbers: [5, 6],
      startTimeFrom: "10:00",
      startTimeTo: "18:00",
      memberTier: "platinum",
      saleOpensAtOverride: "2026-09-27T20:30:00+09:00",
    });
  });

  it("lists rules in creation order", () => {
    repository.create({ ...makeInput(), id: "a" }, new Date("2026-01-01T00:00:00Z"));
    repository.create({ ...makeInput(), id: "b" }, new Date("2026-01-02T00:00:00Z"));

    expect(repository.list().map((rule) => rule.id)).toEqual(["a", "b"]);
  });

  it("enables and disables a rule", () => {
    repository.create({ ...makeInput(), id: "rule-3" });

    expect(repository.setEnabled("rule-3", false)).toBe(true);
    expect(repository.get("rule-3")?.enabled).toBe(false);
    expect(repository.setEnabled("missing", false)).toBe(false);
  });

  it("stores runtime state independently", () => {
    repository.create({ ...makeInput(), id: "rule-4" });
    repository.setRuntimeState("rule-4", { lastState: "waiting_for_sale" });
    repository.setRuntimeState("rule-4", { lastNotificationKey: "key-1" });

    expect(repository.getRuntimeState("rule-4")).toEqual({
      lastState: "waiting_for_sale",
      lastNotificationKey: "key-1",
    });
    expect(repository.listEvents("rule-4")).toEqual([]);
  });

  it("appends and lists events", () => {
    repository.create({ ...makeInput(), id: "rule-5" });
    repository.appendEvent({ ruleId: "rule-5", state: "created" });
    repository.appendEvent({
      ruleId: "rule-5",
      state: "waiting_for_sale",
      performanceId: "perf-1",
      detail: "found",
    });

    expect(repository.listEvents("rule-5")).toEqual([
      { state: "created", performanceId: null, detail: null },
      { state: "waiting_for_sale", performanceId: "perf-1", detail: "found" },
    ]);
  });

  it("removes a rule", () => {
    repository.create({ ...makeInput(), id: "rule-6" });

    expect(repository.remove("rule-6")).toBe(true);
    expect(repository.get("rule-6")).toBeUndefined();
    expect(repository.remove("rule-6")).toBe(false);
  });
});
