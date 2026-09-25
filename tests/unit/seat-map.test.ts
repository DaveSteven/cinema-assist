import { describe, expect, it } from "vitest";
import {
  assertSeatStateCount,
  type DomSeat,
  determineScreenSide,
  mergeSeatMap,
  parseSeatLegend,
  parseSeatState,
  parseTheaterLayout,
  requireSeatState,
  SeatStateCountMismatchError,
  type SeatStateInfo,
  SeatStateUnavailableError,
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
  });

  it("flags an invalid payload as not ok", () => {
    const info = parseSeatState({ nope: true });
    expect(info.ok).toBe(false);
    expect(info.availableKeys.size).toBe(0);
    expect(info.countFree).toBeUndefined();
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
      availableKeys: new Set(["A1"]),
      byKey: new Map(),
    };
    expect(() => assertSeatStateCount(info, [makeSeat()])).toThrow(SeatStateCountMismatchError);
  });

  it("skips validation when the API omits cntReserveFree", () => {
    const info: SeatStateInfo = { ok: true, availableKeys: new Set(), byKey: new Map() };
    expect(() => assertSeatStateCount(info, [makeSeat()])).not.toThrow();
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
