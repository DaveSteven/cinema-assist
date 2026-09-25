import { describe, expect, it } from "vitest";
import { ScheduleClient } from "../../src/adapters/cinemasunshine/schedule-client.js";
import { normalizeDaySchedule } from "../../src/adapters/cinemasunshine/schedule-normalizer.js";
import {
  dayScheduleSchema,
  scheduleIndexSchema,
  theatersSchema,
} from "../../src/adapters/cinemasunshine/schedule-schema.js";
import { filterScreenings } from "../../src/domain/screening.js";
import { fixtureText, readFixtureJson } from "../helpers.js";

const NOW = new Date("2026-09-10T00:00:00.000Z");

describe("schedule fixtures stay offline and stable", () => {
  it("parses the schedule index and keeps unknown diagnostic fields", () => {
    const index = scheduleIndexSchema.parse(readFixtureJson("schedule-index.json"));

    expect(Object.keys(index).sort()).toEqual(["0123456", "2647900", "2764800", "2852500"]);
    expect(index["2852500"]?.["020"]?.["20260918"]?.["1105"]?.[0]?.branchCode).toBe("90");

    const diagnostic = index["0123456"]?.["012"]?.["20260918"]?.["1000"]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(diagnostic?.customDiagnostic).toBe("preserve-me");
  });

  it("validates the theater index including rooms and missing rooms", () => {
    const theaters = theatersSchema.parse(readFixtureJson("theaters.json"));

    expect(theaters["020"]?.name.ja).toBe("グランドシネマサンシャイン 池袋");
    expect(theaters["020"]?.rooms).toBeUndefined();
    expect(theaters["012"]?.rooms?.["20"]?.name.ja).toBe("4DX");
  });

  it("selects the target showtime and performance id from a day fixture", () => {
    const day = dayScheduleSchema.parse(readFixtureJson("2845300-020-20260918.json"));
    const screenings = normalizeDaySchedule(day, {
      movieCode: "2845300",
      theaterCode: "020",
      now: NOW,
    });

    const selected = filterScreenings(screenings, {
      targetDate: "2026-09-18",
      titleIncludes: "ちいかわ",
      formatIncludes: ["sola"],
      startTimeFrom: "15:00",
      startTimeTo: "23:59",
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.performanceId).toBe("020284530202609181011530");
    expect(selected[0]?.salesStatus).toBe("not_open");
  });

  it("does not match a different format or time window", () => {
    const day = dayScheduleSchema.parse(readFixtureJson("2852500-020-20260918.json"));
    const screenings = normalizeDaySchedule(day, {
      movieCode: "2852500",
      theaterCode: "020",
      now: NOW,
    });

    expect(filterScreenings(screenings, { formatExcludes: ["字幕"] })).toHaveLength(0);
    expect(filterScreenings(screenings, { startTimeFrom: "12:00" })).toHaveLength(0);
    expect(filterScreenings(screenings, { titleIncludes: "時には懺悔を" })).toHaveLength(0);
  });

  it("reads day schedules through the client without touching the network", async () => {
    const client = new ScheduleClient({
      baseUrl: "https://fixture.test",
      now: () => 1,
      fetchImpl: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === "/schedule/data/2845300/020/20260918.json") {
          return new Response(fixtureText("2845300-020-20260918.json"), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
    });

    const day = await client.fetchDaySchedule("2845300", "020", "20260918");
    expect(day?.["1310"]?.["101"]?.id).toBe("020284530202609181011310");

    await expect(client.fetchDaySchedule("9999999", "020", "20260918")).resolves.toBeNull();
  });
});
