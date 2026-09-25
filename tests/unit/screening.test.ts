import { describe, expect, it } from "vitest";
import {
  filterScreenings,
  formatHaystack,
  type Screening,
  sortScreeningsByStart,
  startsAtDate,
  startsAtTime,
} from "../../src/domain/screening.js";

function makeScreening(overrides: Partial<Screening> = {}): Screening {
  return {
    performanceId: "02000000020260918000000",
    movieCode: "0000000",
    movieTitle: "テスト映画",
    theaterCode: "020",
    screenName: "シアター１",
    formatLabels: [],
    startsAt: "2026-09-18T10:00:00+09:00",
    salesStatus: "open",
    salesWindows: { public: {} },
    ...overrides,
  };
}

describe("startsAt helpers", () => {
  it("reads the JST date and time from a normalized timestamp", () => {
    const screening = makeScreening({ startsAt: "2026-09-18T21:25:00+09:00" });
    expect(startsAtDate(screening.startsAt)).toBe("2026-09-18");
    expect(startsAtTime(screening.startsAt)).toBe("21:25");
  });
});

describe("filterScreenings", () => {
  it("filters by target date", () => {
    const items = [
      makeScreening({ performanceId: "a", startsAt: "2026-09-18T10:00:00+09:00" }),
      makeScreening({ performanceId: "b", startsAt: "2026-09-19T10:00:00+09:00" }),
    ];
    expect(
      filterScreenings(items, { targetDate: "2026-09-19" }).map((s) => s.performanceId),
    ).toEqual(["b"]);
  });

  it("filters by case-insensitive title substring", () => {
    const items = [
      makeScreening({ performanceId: "a", movieTitle: "スパイダーマン【字幕】" }),
      makeScreening({ performanceId: "b", movieTitle: "ちいかわ" }),
    ];
    expect(
      filterScreenings(items, { titleIncludes: "ちいかわ" }).map((s) => s.performanceId),
    ).toEqual(["b"]);
  });

  it("filters by title regular expression", () => {
    const items = [
      makeScreening({ performanceId: "a", movieTitle: "作品A 字幕" }),
      makeScreening({ performanceId: "b", movieTitle: "作品B 吹替" }),
    ];
    expect(filterScreenings(items, { titlePattern: "吹替" }).map((s) => s.performanceId)).toEqual([
      "b",
    ]);
  });

  it("throws on an invalid title regular expression", () => {
    expect(() => filterScreenings([], { titlePattern: "([" })).toThrow(/Invalid titlePattern/);
  });

  it("requires every formatIncludes term to be present", () => {
    const items = [
      makeScreening({ performanceId: "a", formatLabels: ["字幕"] }),
      makeScreening({ performanceId: "b", formatLabels: ["字幕", "IMAX"] }),
    ];
    expect(
      filterScreenings(items, { formatIncludes: ["IMAX"] }).map((s) => s.performanceId),
    ).toEqual(["b"]);
  });

  it("rejects any formatExcludes term", () => {
    const items = [
      makeScreening({ performanceId: "a", formatLabels: ["字幕"] }),
      makeScreening({ performanceId: "b", formatLabels: ["吹替"] }),
    ];
    expect(
      filterScreenings(items, { formatExcludes: ["字幕"] }).map((s) => s.performanceId),
    ).toEqual(["b"]);
  });

  it("matches format terms against the title and screen name too", () => {
    const items = [
      makeScreening({ performanceId: "a", movieTitle: "X【字幕】" }),
      makeScreening({ performanceId: "b", screenName: "シアター５ BESTIA" }),
    ];
    expect(
      filterScreenings(items, { formatIncludes: ["字幕", "BESTIA"] }).map((s) => s.performanceId),
    ).toEqual([]);
    expect(
      filterScreenings(items, { formatIncludes: ["BESTIA"] }).map((s) => s.performanceId),
    ).toEqual(["b"]);
  });

  it("filters by inclusive start-time window", () => {
    const items = [
      makeScreening({ performanceId: "a", startsAt: "2026-09-18T08:00:00+09:00" }),
      makeScreening({ performanceId: "b", startsAt: "2026-09-18T12:30:00+09:00" }),
      makeScreening({ performanceId: "c", startsAt: "2026-09-18T21:25:00+09:00" }),
    ];
    expect(
      filterScreenings(items, { startTimeFrom: "10:00", startTimeTo: "13:00" }).map(
        (s) => s.performanceId,
      ),
    ).toEqual(["b"]);
  });

  it("combines all criteria", () => {
    const items = [
      makeScreening({
        performanceId: "target",
        movieTitle: "ちいかわ",
        formatLabels: ["sola"],
        startsAt: "2026-09-18T15:30:00+09:00",
      }),
      makeScreening({
        performanceId: "wrong-time",
        movieTitle: "ちいかわ",
        formatLabels: ["sola"],
        startsAt: "2026-09-18T13:10:00+09:00",
      }),
      makeScreening({
        performanceId: "wrong-format",
        movieTitle: "ちいかわ",
        startsAt: "2026-09-18T15:30:00+09:00",
      }),
    ];
    expect(
      filterScreenings(items, {
        targetDate: "2026-09-18",
        titleIncludes: "ちいかわ",
        formatIncludes: ["sola"],
        startTimeFrom: "15:00",
      }).map((s) => s.performanceId),
    ).toEqual(["target"]);
  });
});

describe("sortScreeningsByStart", () => {
  it("sorts by start time then performance id without mutating input", () => {
    const items = [
      makeScreening({ performanceId: "b", startsAt: "2026-09-18T15:30:00+09:00" }),
      makeScreening({ performanceId: "a", startsAt: "2026-09-18T13:10:00+09:00" }),
    ];
    const sorted = sortScreeningsByStart(items);
    expect(sorted.map((s) => s.performanceId)).toEqual(["a", "b"]);
    expect(items[0]?.performanceId).toBe("b");
  });
});

describe("formatHaystack", () => {
  it("combines title, screen name and labels", () => {
    const screening = makeScreening({
      movieTitle: "X",
      screenName: "シアター５ BESTIA",
      formatLabels: ["字幕"],
    });
    expect(formatHaystack(screening)).toBe("x\nシアター５ bestia\n字幕");
  });
});
