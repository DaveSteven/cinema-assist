import { describe, expect, it } from "vitest";
import { parseWatchRuleInput } from "../../src/domain/watch-rule.js";

describe("parseWatchRuleInput", () => {
  it("applies defaults for the minimal input", () => {
    const rule = parseWatchRuleInput({ movieTitlePattern: "作品", targetDate: "2026-09-29" });

    expect(rule).toMatchObject({
      theaterCode: "020",
      movieTitlePattern: "作品",
      targetDate: "2026-09-29",
      formatIncludes: [],
      formatExcludes: [],
      ticketCount: 1,
      requireAdjacent: true,
      aislePreference: "none",
      mode: "notify",
      memberTier: "none",
    });
  });

  it("accepts a full valid input", () => {
    const rule = parseWatchRuleInput({
      movieTitlePattern: "スパイダーマン",
      targetDate: "2026-09-29",
      formatIncludes: ["IMAX"],
      formatExcludes: ["吹替"],
      startTimeFrom: "10:00",
      startTimeTo: "18:00",
      ticketCount: 2,
      requireAdjacent: true,
      aislePreference: "prefer",
      mode: "notify",
      memberTier: "platinum",
      saleOpensAtOverride: "2026-09-27T20:30:00+09:00",
    });

    expect(rule.ticketCount).toBe(2);
    expect(rule.startTimeFrom).toBe("10:00");
  });

  it("rejects an invalid title regular expression", () => {
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "(", targetDate: "2026-09-29" }),
    ).toThrow();
  });

  it.each([0, 7, 1.5])("rejects ticketCount %s", (ticketCount) => {
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2026-09-29", ticketCount }),
    ).toThrow();
  });

  it("rejects a malformed date or time", () => {
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2026/09/29" }),
    ).toThrow();
    expect(() =>
      parseWatchRuleInput({
        movieTitlePattern: "X",
        targetDate: "2026-09-29",
        startTimeFrom: "9:00",
      }),
    ).toThrow();
  });

  it("accepts a real leap day and rejects impossible calendar dates", () => {
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2024-02-29" }),
    ).not.toThrow();
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2025-02-29" }),
    ).toThrow();
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2026-02-30" }),
    ).toThrow();
    expect(() =>
      parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2026-13-01" }),
    ).toThrow();
  });

  it("rejects an unparseable saleOpensAtOverride", () => {
    expect(() =>
      parseWatchRuleInput({
        movieTitlePattern: "X",
        targetDate: "2026-09-29",
        saleOpensAtOverride: "not-a-date",
      }),
    ).toThrow();
    expect(() =>
      parseWatchRuleInput({
        movieTitlePattern: "X",
        targetDate: "2026-09-29",
        saleOpensAtOverride: "2026-09-27T20:30:00+09:00",
      }),
    ).not.toThrow();
  });

  it("rejects an inverted time window", () => {
    expect(() =>
      parseWatchRuleInput({
        movieTitlePattern: "X",
        targetDate: "2026-09-29",
        startTimeFrom: "18:00",
        startTimeTo: "10:00",
      }),
    ).toThrow();
  });

  it("rejects an unsupported theater code", () => {
    expect(() =>
      parseWatchRuleInput({
        theaterCode: "999",
        movieTitlePattern: "X",
        targetDate: "2026-09-29",
      }),
    ).toThrow();
  });
});
