import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  assertSeatStateCount,
  type DomSeat,
  determineScreenSide,
  isSeatStateConsistent,
  labelsMatch,
  mergeSeatMap,
  normalizeSeatToken,
  parseSeatLegend,
  parseSeatState,
  parseTheaterLayout,
  requireSeatState,
  SeatStateCountMismatchError,
  type SeatStateInfo,
  SeatStateUnavailableError,
  waitForSeatMap,
  waitForSeatPage,
} from "../../src/adapters/cinemasunshine/seat-map.js";
import type { Seat } from "../../src/domain/seat.js";
import { readFixtureJson } from "../helpers.js";

function makeSeat(overrides: Partial<Seat> = {}): Seat {
  return {
    section: "",
    row: "A",
    number: 1,
    label: "a1",
    available: true,
    selectable: true,
    wheelchair: false,
    seatType: "standard",
    surchargeYen: 0,
    ...overrides,
  };
}

describe("parseSeatState", () => {
  it("maps full-width free seat labels and keeps special-seat data", () => {
    const info = parseSeatState({
      cntReserveFree: 72,
      cntSeatLine: 10,
      listSeat: [
        {
          seatSection: "   ",
          listFreeSeat: [
            { seatNum: "ａ－６", spseatKbn: "000", spseatAdd1: 0, spseatAdd2: 0 },
            { seatNum: "車椅子1", spseatKbn: "000", spseatAdd1: 0, spseatAdd2: 0 },
          ],
        },
      ],
    });

    expect(info.ok).toBe(true);
    expect(info.countFree).toBe(72);
    expect(info.availableKeys.has("A6")).toBe(true);
    expect(info.availableKeys.has("A7")).toBe(false);
    expect(info.availableKeys.size).toBe(1);
    expect(info.unmappableFree).toBe(1);
  });

  it("flags an invalid payload as not ok", () => {
    const info = parseSeatState({ nope: true });
    expect(info.ok).toBe(false);
    expect(info.availableKeys.size).toBe(0);
    expect(info.countFree).toBeUndefined();
  });

  it("counts duplicate API seat keys", () => {
    const info = parseSeatState({
      cntReserveFree: 1,
      listSeat: [{ listFreeSeat: [{ seatNum: "ａ－６" }, { seatNum: "ａ－６" }] }],
    });
    expect(info.availableKeys.size).toBe(1);
    expect(info.duplicateFreeKeys).toBe(1);
  });
});

describe("requireSeatState", () => {
  it("returns info for an ok outcome", () => {
    const info: SeatStateInfo = { ok: true, availableKeys: new Set(), byKey: new Map() };
    expect(requireSeatState({ status: "ok", info })).toBe(info);
  });

  it("distinguishes timeout from invalid", () => {
    const timeout = (() => {
      try {
        requireSeatState({ status: "timeout" });
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(timeout).toBeInstanceOf(SeatStateUnavailableError);
    expect((timeout as SeatStateUnavailableError).reason).toBe("timeout");

    const invalid = (() => {
      try {
        requireSeatState({ status: "invalid" });
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect((invalid as SeatStateUnavailableError).reason).toBe("invalid");
  });
});

describe("assertSeatStateCount", () => {
  it("accepts a consistent count", () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 2,
      availableKeys: new Set(["A1", "A2"]),
      byKey: new Map(),
    };
    expect(() =>
      assertSeatStateCount(info, [makeSeat({ number: 1 }), makeSeat({ number: 2 })]),
    ).not.toThrow();
  });

  it("accepts a legitimate zero-availability result", () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 0,
      availableKeys: new Set(),
      byKey: new Map(),
    };
    expect(() =>
      assertSeatStateCount(info, [makeSeat({ available: false, selectable: false })]),
    ).not.toThrow();
  });

  it("rejects an inconsistent count", () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 5,
      availableKeys: new Set(["A1", "A2"]),
      byKey: new Map(),
    };
    expect(() => assertSeatStateCount(info, [makeSeat()])).toThrow(SeatStateCountMismatchError);
  });

  it("expects zero when no mapped API key is free", () => {
    const info: SeatStateInfo = { ok: true, availableKeys: new Set(), byKey: new Map() };
    expect(() =>
      assertSeatStateCount(info, [makeSeat({ available: false, selectable: false })]),
    ).not.toThrow();
    expect(() => assertSeatStateCount(info, [makeSeat()])).toThrow(SeatStateCountMismatchError);
  });
});

describe("isSeatStateConsistent", () => {
  function keys(count: number): Set<string> {
    const set = new Set<string>();
    for (let index = 1; index <= count; index += 1) set.add(`A${index}`);
    return set;
  }

  it("accepts the real mapped-count relationships", () => {
    expect(
      isSeatStateConsistent({
        ok: true,
        countFree: 72,
        unmappableFree: 2,
        availableKeys: keys(72),
        byKey: new Map(),
      }),
    ).toBe(true);
    expect(
      isSeatStateConsistent({
        ok: true,
        countFree: 264,
        unmappableFree: 1,
        availableKeys: keys(263),
        byKey: new Map(),
      }),
    ).toBe(true);
  });

  it("rejects contradictory or duplicate responses", () => {
    expect(
      isSeatStateConsistent({
        ok: true,
        countFree: 5,
        unmappableFree: 0,
        availableKeys: keys(1),
        byKey: new Map(),
      }),
    ).toBe(false);
    expect(
      isSeatStateConsistent({
        ok: true,
        countFree: 1,
        unmappableFree: 0,
        duplicateFreeKeys: 1,
        availableKeys: keys(1),
        byKey: new Map(),
      }),
    ).toBe(false);
    expect(isSeatStateConsistent({ ok: false, availableKeys: new Set(), byKey: new Map() })).toBe(
      false,
    );
  });
});

describe("determineScreenSide", () => {
  const seatYs = [200, 260, 320, 380];

  it("detects a screen above or below the seats", () => {
    expect(determineScreenSide(90, seatYs)).toBe("top");
    expect(determineScreenSide(500, seatYs)).toBe("bottom");
  });

  it("returns unknown when the screen marker is missing or between seats", () => {
    expect(determineScreenSide(undefined, seatYs)).toBe("unknown");
    expect(determineScreenSide(300, seatYs)).toBe("unknown");
    expect(determineScreenSide(90, [])).toBe("unknown");
  });
});

describe("parseTheaterLayout", () => {
  it("reads the screen marker position from a real theater layout", () => {
    const layout = parseTheaterLayout(readFixtureJson("theater-layout-top.json"));
    expect(layout.screenSide).toBe("top");
    expect(layout.screenY).toBe(90);
    expect(layout.seatStartY).toBe(223);
  });

  it("detects a screen below the seat start", () => {
    const layout = parseTheaterLayout({
      objects: [{ image: "/images/theater/20/screen/099.svg", x: 300, y: 700 }],
      seatStart: { x: 100, y: 100 },
    });
    expect(layout.screenSide).toBe("bottom");
  });

  it("returns unknown for a layout without a screen marker", () => {
    expect(parseTheaterLayout({ objects: [], seatStart: { y: 100 } }).screenSide).toBe("unknown");
    expect(parseTheaterLayout({ nope: true }).screenSide).toBe("unknown");
  });
});

describe("parseSeatLegend", () => {
  it("parses surcharge and price category from the legend text", () => {
    const legend = parseSeatLegend([
      {
        className: "seat-premium-class col-12 col-md-6",
        text: "プレミアムクラス +￥1,600 （ミールクーポン700円分含む）",
      },
      { className: "seat-comfort", text: "フラットシート" },
      { className: "seat-ottoman", text: "スタンダードクラス オットマン" },
    ]);

    const premium = legend.find((entry) => entry.seatType === "premiumClass");
    expect(premium?.surchargeYen).toBe(1600);
    expect(premium?.priceCategory).toBe("プレミアムクラス");

    const comfort = legend.find((entry) => entry.seatType === "comfort");
    expect(comfort?.surchargeYen).toBeUndefined();
    expect(comfort?.priceCategory).toBe("フラットシート");

    const ottoman = legend.find((entry) => entry.seatType === "ottoman");
    expect(ottoman?.priceCategory).toBe("スタンダードクラス オットマン");
  });
});

describe("mergeSeatMap", () => {
  const legend = parseSeatLegend([
    { className: "seat-premium-class", text: "プレミアムクラス +￥1,600" },
  ]);

  it("merges DOM seats with availability and price info", () => {
    const domSeats: DomSeat[] = [
      { label: "a6", className: "seat seat-A seat-A6", x: 587, y: 201 },
      { label: "d4", className: "seat seat-D seat-D4 seat-premium-class", x: 220, y: 380 },
      { label: "a12", className: "seat seat-A seat-A12 seat-hc", x: 851, y: 223 },
    ];
    const seatState = parseSeatState({
      cntReserveFree: 1,
      listSeat: [{ listFreeSeat: [{ seatNum: "ａ－６" }] }],
    });

    const merged = mergeSeatMap(domSeats, legend, seatState);
    const a6 = merged.find((seat) => seat.label === "a6");
    const d4 = merged.find((seat) => seat.label === "d4");
    const a12 = merged.find((seat) => seat.label === "a12");

    expect(a6).toMatchObject({
      row: "A",
      number: 6,
      seatType: "standard",
      surchargeYen: 0,
      available: true,
      selectable: true,
      x: 587,
      y: 201,
    });
    expect(d4).toMatchObject({
      seatType: "premiumClass",
      priceCategory: "プレミアムクラス",
      surchargeYen: 1600,
      available: false,
      selectable: false,
    });
    expect(a12).toMatchObject({ wheelchair: true, selectable: false });
  });
});

describe("real sanitized fixtures", () => {
  it("parses a real seat-state payload and a real DOM/legend payload", () => {
    const state = parseSeatState(readFixtureJson("seat-state-bestia.json"));
    expect(state.ok).toBe(true);
    expect(state.countFree).toBe(3);
    expect(state.availableKeys.has("D4")).toBe(true);
    expect(state.availableKeys.has("E5")).toBe(true);

    const dom = readFixtureJson("seat-dom-bestia.json") as {
      seats: DomSeat[];
      legend: { className: string; text: string }[];
    };
    const legend = parseSeatLegend(dom.legend);
    const seats = mergeSeatMap(dom.seats, legend, state);

    expect(seats.find((seat) => seat.label === "d4")).toMatchObject({
      seatType: "premiumClass",
      surchargeYen: 1600,
      available: true,
    });
    expect(seats.find((seat) => seat.label === "e5")).toMatchObject({
      seatType: "grandClass",
      surchargeYen: 3100,
      available: true,
    });
    expect(seats.find((seat) => seat.label === "c3")).toMatchObject({
      seatType: "standard",
      surchargeYen: 0,
      available: false,
    });

    expect(() => assertSeatStateCount(state, seats)).not.toThrow();
  });
});

describe("normalizeSeatToken and labelsMatch", () => {
  it("normalizes labels and compares sets exactly", () => {
    expect(normalizeSeatToken(" e8 ")).toBe("E8");
    expect(normalizeSeatToken("ｄ－４")).toBe("D4");
    expect(labelsMatch(["E8", "E9"], ["E9", "E8"])).toBe(true);
    expect(labelsMatch(["E8", "E9"], ["E8"])).toBe(false);
    expect(labelsMatch(["E8", "E9"], ["E8", "E9", "E9"])).toBe(false);
    expect(labelsMatch(["E8"], ["E9"])).toBe(false);
  });
});

describe("waitForSeatMap", () => {
  it("waits for the DOM to stabilize against the API count", async () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 1,
      availableKeys: new Set(["D3"]),
      byKey: new Map(),
    };
    const empty = {
      seats: [],
      legend: [],
      screenSide: "unknown" as const,
      seatElementCount: 0,
      parsedDomSeatCount: 0,
    };
    const ready = {
      seats: [makeSeat({ row: "D", number: 3 })],
      legend: [],
      screenSide: "top" as const,
      seatElementCount: 1,
      parsedDomSeatCount: 1,
    };
    let calls = 0;
    const read = async () => {
      calls += 1;
      return calls === 1 ? empty : ready;
    };

    const result = await waitForSeatMap({} as Page, info, { timeoutMs: 500, pollMs: 1, read });

    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.seats).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("matches the DOM against mapped API keys, ignoring unmappable seats", async () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 1,
      unmappableFree: 1,
      availableKeys: new Set(["D3"]),
      byKey: new Map(),
    };
    const read = async () => ({
      seats: [makeSeat({ row: "D", number: 3 })],
      legend: [],
      screenSide: "top" as const,
      seatElementCount: 1,
      parsedDomSeatCount: 1,
    });

    const result = await waitForSeatMap({} as Page, info, { timeoutMs: 200, pollMs: 1, read });
    expect(result.status).toBe("ready");
  });

  it("matches the real 264/263/1 scenario", async () => {
    const keys = new Set<string>();
    for (let index = 1; index <= 263; index += 1) keys.add(`A${index}`);
    const info: SeatStateInfo = {
      ok: true,
      countFree: 264,
      unmappableFree: 1,
      availableKeys: keys,
      byKey: new Map(),
    };
    const seats = [...keys].map((key) => {
      const number = Number(key.slice(1));
      return makeSeat({ row: "A", number, label: `a${number}` });
    });
    const read = async () => ({
      seats,
      legend: [],
      screenSide: "top" as const,
      seatElementCount: seats.length,
      parsedDomSeatCount: seats.length,
    });

    const result = await waitForSeatMap({} as Page, info, { timeoutMs: 200, pollMs: 1, read });
    expect(result.status).toBe("ready");
  });

  it("returns timeout diagnostics when the DOM never matches", async () => {
    const info: SeatStateInfo = {
      ok: true,
      countFree: 5,
      unmappableFree: 1,
      availableKeys: new Set(["D3"]),
      byKey: new Map(),
    };
    const empty = {
      seats: [],
      legend: [],
      screenSide: "unknown" as const,
      seatElementCount: 0,
      parsedDomSeatCount: 0,
      url: "https://transaction.ticket-cinemasunshine.com/#/purchase/seat",
    };

    const result = await waitForSeatMap({} as Page, info, {
      timeoutMs: 20,
      pollMs: 1,
      read: async () => empty,
    });

    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.apiFreeCount).toBe(5);
      expect(result.mappedApiFree).toBe(1);
      expect(result.unmappableFree).toBe(1);
      expect(result.availableCount).toBe(0);
      expect(result.domSeatElementCount).toBe(0);
      expect(result.url).toContain("/#/purchase/seat");
    }
  });
});

describe("waitForSeatPage", () => {
  it("waits for the seat route and selector, and times out otherwise", async () => {
    let count = 0;
    const page = {
      url: () => "https://transaction.ticket-cinemasunshine.com/#/purchase/seat",
      locator: () => ({ count: async () => count }),
    } as unknown as Page;

    const first = waitForSeatPage(page, { timeoutMs: 300, pollMs: 5 });
    setTimeout(() => {
      count = 3;
    }, 20);
    await expect(first).resolves.toBe(true);

    const never = {
      url: () => "https://transaction.ticket-cinemasunshine.com/#/purchase/seat",
      locator: () => ({ count: async () => 0 }),
    } as unknown as Page;
    await expect(waitForSeatPage(never, { timeoutMs: 20, pollMs: 1 })).resolves.toBe(false);
  });
});
