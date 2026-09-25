import { describe, expect, it } from "vitest";
import {
  backoffWithJitter,
  expectedSaleOpensAt,
  MEMBER_TIER_OPEN,
  pollSchedule,
} from "../../src/services/sale-time-service.js";

describe("expectedSaleOpensAt", () => {
  it("uses 3 days before 20:30 JST for platinum", () => {
    expect(expectedSaleOpensAt({ targetDate: "2026-09-29", memberTier: "platinum" })).toBe(
      "2026-09-26T20:30:00+09:00",
    );
  });

  it("uses 3 days before 21:00 JST for bronze and gold", () => {
    expect(expectedSaleOpensAt({ targetDate: "2026-09-29", memberTier: "bronze" })).toBe(
      "2026-09-26T21:00:00+09:00",
    );
    expect(expectedSaleOpensAt({ targetDate: "2026-09-29", memberTier: "gold" })).toBe(
      "2026-09-26T21:00:00+09:00",
    );
  });

  it("uses 2 days before 00:00 JST for non-members", () => {
    expect(expectedSaleOpensAt({ targetDate: "2026-09-29", memberTier: "none" })).toBe(
      "2026-09-27T00:00:00+09:00",
    );
  });

  it("treats a missing tier as non-member", () => {
    expect(expectedSaleOpensAt({ targetDate: "2026-09-29" })).toBe("2026-09-27T00:00:00+09:00");
  });

  it("normalizes an override to JST and never overrides site data by tier", () => {
    expect(
      expectedSaleOpensAt({
        targetDate: "2026-09-29",
        memberTier: "platinum",
        saleOpensAtOverride: "2026-09-25T12:00:00Z",
      }),
    ).toBe("2026-09-25T21:00:00+09:00");
  });

  it("exposes the documented tier presets", () => {
    expect(MEMBER_TIER_OPEN.platinum).toEqual({ daysBefore: 3, hour: 20, minute: 30 });
    expect(MEMBER_TIER_OPEN.none).toEqual({ daysBefore: 2, hour: 0, minute: 0 });
  });
});

describe("pollSchedule", () => {
  const expected = "2026-09-27T00:00:00+09:00";
  const opensAt = Date.parse(expected);
  const at = (msBeforeOpen: number): Date => new Date(opensAt - msBeforeOpen);

  it.each([
    [7 * 3_600_000, "far", 600_000],
    [3 * 3_600_000, "approaching", 120_000],
    [20 * 60_000, "approaching", 120_000],
    [5 * 60_000, "near", 30_000],
    [30_000, "imminent", 10_000],
    [0, "due", 3_000],
    [-60_000, "due", 3_000],
    [-3 * 60_000, "overdue", 120_000],
  ])("maps offset %i ms to %s", (offsetMs, phase, intervalMs) => {
    expect(pollSchedule(expected, at(offsetMs))).toEqual({ phase, intervalMs });
  });

  it("rejects an invalid expected time", () => {
    expect(() => pollSchedule("not-a-date", new Date())).toThrow(/Invalid expectedOpenAt/);
  });
});

describe("backoffWithJitter", () => {
  it("grows exponentially and stays within the cap", () => {
    const noJitter = { random: () => 0 };
    expect(backoffWithJitter(1, noJitter)).toBe(3_000);
    expect(backoffWithJitter(2, noJitter)).toBe(6_000);
    expect(backoffWithJitter(3, noJitter)).toBe(12_000);
    expect(backoffWithJitter(20, noJitter)).toBe(300_000);
  });

  it("adds bounded jitter", () => {
    const high = backoffWithJitter(1, { random: () => 0.999 });
    expect(high).toBeGreaterThan(3_000);
    expect(high).toBeLessThanOrEqual(3_999);
  });
});
