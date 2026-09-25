import { describe, expect, it } from "vitest";
import {
  buildSalesWindows,
  classifySalesStatus,
  extractFormatLabels,
  listMovieCodesForTheaterDate,
  normalizeDaySchedule,
  pickLocalizedName,
  selectSalesWindow,
  toJstIsoString,
} from "../../src/adapters/cinemasunshine/schedule-normalizer.js";
import {
  dayScheduleSchema,
  scheduleIndexSchema,
} from "../../src/adapters/cinemasunshine/schedule-schema.js";
import { readFixtureJson } from "../helpers.js";

const subtitleDay = dayScheduleSchema.parse(readFixtureJson("2852500-020-20260918.json"));
const multiDay = dayScheduleSchema.parse(readFixtureJson("2845300-020-20260918.json"));
const futureDay = dayScheduleSchema.parse(readFixtureJson("2922222-020-20260929.json"));
const index = scheduleIndexSchema.parse(readFixtureJson("schedule-index.json"));

describe("toJstIsoString", () => {
  it("converts a UTC instant into a JST ISO string", () => {
    expect(toJstIsoString("2026-09-18T02:05:00.000Z")).toBe("2026-09-18T11:05:00+09:00");
  });

  it("normalizes an already-offset instant", () => {
    expect(toJstIsoString("2026-09-18T13:40:00+0900")).toBe("2026-09-18T13:40:00+09:00");
  });

  it("rolls over the date boundary correctly", () => {
    expect(toJstIsoString("2026-09-17T23:00:00.000Z")).toBe("2026-09-18T08:00:00+09:00");
  });

  it("rejects invalid date values", () => {
    expect(() => toJstIsoString("not-a-date")).toThrow(/Invalid date value/);
  });
});

describe("pickLocalizedName", () => {
  it("prefers ja then en then empty", () => {
    expect(pickLocalizedName({ ja: "日本語", en: "English" })).toBe("日本語");
    expect(pickLocalizedName({ en: "English" })).toBe("English");
    expect(pickLocalizedName({ ja: "  ", en: "English" })).toBe("English");
    expect(pickLocalizedName(undefined)).toBe("");
  });
});

describe("extractFormatLabels", () => {
  it("extracts bracketed tags from the title", () => {
    expect(extractFormatLabels("スパイダーマン【字幕】", "シアター９")).toEqual(["字幕"]);
  });

  it("extracts slash suffixes from the title", () => {
    expect(extractFormatLabels("X / Dolby Atmos", "シアター３")).toEqual(["Dolby Atmos"]);
  });

  it("extracts room format tokens", () => {
    expect(extractFormatLabels("映画ちいかわ 人魚の島のひみつ", "シアター10 sola")).toEqual([
      "sola",
    ]);
    expect(extractFormatLabels("X", "シアター５ BESTIA")).toEqual(["BESTIA"]);
  });

  it("returns no labels for a plain title and japanese room", () => {
    expect(extractFormatLabels("時には懺悔を", "シアター７")).toEqual([]);
  });
});

describe("classifySalesStatus", () => {
  const publicWindow = {
    startsAt: "2026-09-16T00:00:00+09:00",
    endsAt: "2026-09-18T11:05:00+09:00",
  };

  it("treats a sale window that has not started as not_open", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-10T03:00:00.000Z"),
        window: publicWindow,
        remaining: 50,
        capacity: 100,
      }),
    ).toBe("not_open");
  });

  it("reports open only after the public sale window starts", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-16T00:00:00+09:00"),
        window: publicWindow,
        remaining: 40,
        capacity: 100,
      }),
    ).toBe("open");
  });

  it("marks exhausted capacity as sold_out once open", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-17T00:00:00+09:00"),
        window: publicWindow,
        remaining: 0,
        capacity: 100,
      }),
    ).toBe("sold_out");
  });

  it("marks low capacity as few once open", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-17T00:00:00+09:00"),
        window: publicWindow,
        remaining: 4,
        capacity: 100,
      }),
    ).toBe("few");
  });

  it("marks finished sale windows as ended even when capacity remains", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-30T00:00:00+09:00"),
        window: publicWindow,
        remaining: 10,
        capacity: 100,
      }),
    ).toBe("ended");
  });

  it("stays conservative when the sale window is unknown", () => {
    expect(
      classifySalesStatus({
        now: new Date("2026-09-10T03:00:00.000Z"),
        window: {},
        remaining: 50,
        capacity: 100,
      }),
    ).toBe("not_open");
    expect(
      classifySalesStatus({
        now: new Date("2026-09-10T03:00:00.000Z"),
        remaining: 50,
        capacity: 100,
      }),
    ).toBe("not_open");
  });
});

describe("buildSalesWindows", () => {
  it("maps public and member windows from offers", () => {
    const windows = buildSalesWindows({
      validFrom: "2026-09-27T00:00:00+0900",
      validThrough: "2026-09-29T01:00:00.000Z",
      validFromForMembers: "2026-09-26T11:30:00.000Z",
      validThroughForMembers: "2026-09-29T01:00:00.000Z",
    });

    expect(windows.public).toEqual({
      startsAt: "2026-09-27T00:00:00+09:00",
      endsAt: "2026-09-29T10:00:00+09:00",
    });
    expect(windows.member).toEqual({
      startsAt: "2026-09-26T20:30:00+09:00",
      endsAt: "2026-09-29T10:00:00+09:00",
    });
  });

  it("omits the member window when the payload has none", () => {
    const windows = buildSalesWindows({ validFrom: "2026-09-27T00:00:00+0900" });
    expect(windows.member).toBeUndefined();
  });

  it("falls back to the public window for the member audience", () => {
    const windows = buildSalesWindows({ validFrom: "2026-09-27T00:00:00+0900" });
    expect(selectSalesWindow(windows, "member")).toEqual(windows.public);
  });
});

describe("B-01 sales window regressions (29 Sep fixture)", () => {
  const options = { movieCode: "2922222", theaterCode: "020" };

  it("does not report open before validFrom even though availabilityStarts has passed", () => {
    const [screening] = normalizeDaySchedule(futureDay, {
      ...options,
      now: new Date("2026-09-25T00:00:00.000Z"),
      audience: "public",
    });

    expect(screening?.salesStatus).toBe("not_open");
    expect(screening?.salesWindows.public.startsAt).toBe("2026-09-27T00:00:00+09:00");
  });

  it("reports open for the public audience between validFrom and validThrough", () => {
    const [screening] = normalizeDaySchedule(futureDay, {
      ...options,
      now: new Date("2026-09-27T01:00:00.000Z"),
      audience: "public",
    });

    expect(screening?.salesStatus).toBe("open");
  });

  it("reports ended after validThrough", () => {
    const [screening] = normalizeDaySchedule(futureDay, {
      ...options,
      now: new Date("2026-09-30T00:00:00.000Z"),
      audience: "public",
    });

    expect(screening?.salesStatus).toBe("ended");
  });

  it("opens the member view earlier than the public view", () => {
    const now = new Date("2026-09-26T12:15:00.000Z");
    const [publicView] = normalizeDaySchedule(futureDay, { ...options, now, audience: "public" });
    const [memberView] = normalizeDaySchedule(futureDay, { ...options, now, audience: "member" });

    expect(publicView?.salesStatus).toBe("not_open");
    expect(memberView?.salesStatus).toBe("open");
    expect(memberView?.salesWindows.member?.startsAt).toBe("2026-09-26T20:30:00+09:00");
  });
});

describe("listMovieCodesForTheaterDate", () => {
  it("lists candidate movie codes for a theater and date", () => {
    expect(listMovieCodesForTheaterDate(index, "020", "20260918")).toEqual([
      "2647900",
      "2764800",
      "2852500",
    ]);
  });

  it("excludes other theaters and dates", () => {
    expect(listMovieCodesForTheaterDate(index, "012", "20260918")).toEqual(["0123456"]);
    expect(listMovieCodesForTheaterDate(index, "020", "20260919")).toEqual(["2647900"]);
    expect(listMovieCodesForTheaterDate(index, "020", "20260101")).toEqual([]);
  });
});

describe("normalizeDaySchedule", () => {
  it("normalizes a subtitle screening with JST times and a purchase URL", () => {
    const screenings = normalizeDaySchedule(subtitleDay, {
      movieCode: "2852500",
      theaterCode: "020",
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(screenings).toHaveLength(1);
    expect(screenings[0]).toMatchObject({
      performanceId: "02028525020260918901105",
      movieCode: "2852500",
      movieTitle: "スパイダーマン：ブランド・ニュー・デイ【字幕】",
      theaterCode: "020",
      screenName: "シアター９",
      formatLabels: ["字幕"],
      startsAt: "2026-09-18T11:05:00+09:00",
      endsAt: "2026-09-18T13:40:00+09:00",
      salesStatus: "not_open",
      salesWindows: {
        public: {
          startsAt: "2026-09-16T00:00:00+09:00",
          endsAt: "2026-09-18T11:05:00+09:00",
        },
        member: {
          startsAt: "2026-09-15T20:30:00+09:00",
          endsAt: "2026-09-18T11:05:00+09:00",
        },
      },
      purchaseUrl:
        "https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/02028525020260918901105",
    });
  });

  it("normalizes multiple showtimes in start order", () => {
    const screenings = normalizeDaySchedule(multiDay, { movieCode: "2845300", theaterCode: "020" });

    expect(screenings.map((s) => [s.startsAt, s.performanceId])).toEqual([
      ["2026-09-18T13:10:00+09:00", "020284530202609181011310"],
      ["2026-09-18T15:30:00+09:00", "020284530202609181011530"],
    ]);
    expect(screenings[0]?.formatLabels).toEqual(["sola"]);
  });

  it("prefers the payload smartTheaterNo for the movie code", () => {
    const screenings = normalizeDaySchedule(subtitleDay, {
      movieCode: "fallback-code",
      theaterCode: "020",
    });
    expect(screenings[0]?.movieCode).toBe("2852500");
  });
});
