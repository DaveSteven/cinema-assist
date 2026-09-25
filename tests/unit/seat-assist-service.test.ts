import { describe, expect, it, vi } from "vitest";
import type { PurchaseMeta } from "../../src/adapters/cinemasunshine/purchase-meta.js";
import type { Screening } from "../../src/domain/screening.js";
import type { Seat } from "../../src/domain/seat.js";
import { parseWatchRuleInput, type WatchRule } from "../../src/domain/watch-rule.js";
import {
  type AssistSeatMapResult,
  type SeatAssistDeps,
  SeatAssistService,
  verifyPurchaseMeta,
  verifyScreeningMatchesRule,
} from "../../src/services/seat-assist-service.js";

function makeRule(overrides: Record<string, unknown> = {}): WatchRule {
  return {
    ...parseWatchRuleInput({ movieTitlePattern: "作品", targetDate: "2026-09-18", ...overrides }),
    id: "rule-1",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeScreening(overrides: Partial<Screening> = {}): Screening {
  return {
    performanceId: "02028400020260918101000",
    movieCode: "2840000",
    movieTitle: "作品",
    theaterCode: "020",
    screenName: "シアター１",
    formatLabels: [],
    startsAt: "2026-09-18T10:00:00+09:00",
    salesStatus: "open",
    salesWindows: { public: {} },
    purchaseUrl: "https://example.test/purchase/1",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<PurchaseMeta> = {}): PurchaseMeta {
  return {
    performanceIdFromUrl: "02028400020260918101000",
    theaterName: "グランドシネマサンシャイン 池袋",
    screenName: "シアター１",
    date: "2026-09-18",
    startTime: "10:00",
    title: "作品",
    raw: {
      theaterScreen: "グランドシネマサンシャイン 池袋 / シアター１",
      dateTime: "2026年09月18日(金) 10:00 - 12:00",
      title: "作品",
    },
    ...overrides,
  };
}

function makeSeat(row: string, number: number, overrides: Partial<Seat> = {}): Seat {
  return {
    section: "",
    row,
    number,
    label: `${row}${number}`,
    available: true,
    selectable: true,
    wheelchair: false,
    seatType: "standard",
    surchargeYen: 0,
    x: 100 + number * 40,
    y: 200,
    ...overrides,
  };
}

describe("verifyScreeningMatchesRule", () => {
  it("accepts a matching screening", () => {
    expect(verifyScreeningMatchesRule(makeRule(), makeScreening()).matches).toBe(true);
  });

  it("rejects mismatched date, title, format and time", () => {
    expect(
      verifyScreeningMatchesRule(
        makeRule(),
        makeScreening({ startsAt: "2026-09-19T10:00:00+09:00" }),
      ).matches,
    ).toBe(false);
    expect(
      verifyScreeningMatchesRule(makeRule(), makeScreening({ movieTitle: "全然違うタイトル" }))
        .matches,
    ).toBe(false);
    expect(
      verifyScreeningMatchesRule(
        makeRule({ formatIncludes: ["IMAX"] }),
        makeScreening({ formatLabels: [] }),
      ).matches,
    ).toBe(false);
    expect(
      verifyScreeningMatchesRule(
        makeRule({ startTimeFrom: "18:00" }),
        makeScreening({ startsAt: "2026-09-18T10:00:00+09:00" }),
      ).matches,
    ).toBe(false);
  });
});

describe("verifyPurchaseMeta", () => {
  it("accepts matching page metadata", () => {
    expect(verifyPurchaseMeta(makeRule(), makeScreening(), makeMeta()).matches).toBe(true);
  });

  it("rejects each mismatched field and a missing meta", () => {
    const screening = makeScreening();
    expect(verifyPurchaseMeta(makeRule(), screening, makeMeta({ title: "別の映画" })).matches).toBe(
      false,
    );
    expect(
      verifyPurchaseMeta(makeRule(), screening, makeMeta({ date: "2026-09-19" })).matches,
    ).toBe(false);
    expect(
      verifyPurchaseMeta(makeRule(), screening, makeMeta({ startTime: "11:00" })).matches,
    ).toBe(false);
    expect(
      verifyPurchaseMeta(makeRule(), screening, makeMeta({ screenName: "シアター９" })).matches,
    ).toBe(false);
    expect(
      verifyPurchaseMeta(makeRule(), screening, makeMeta({ theaterName: "別館" })).matches,
    ).toBe(false);
    expect(verifyPurchaseMeta(makeRule(), screening, undefined).matches).toBe(false);
    expect(
      verifyPurchaseMeta(makeRule(), screening, makeMeta({ performanceIdFromUrl: undefined }))
        .matches,
    ).toBe(false);
    expect(verifyPurchaseMeta(makeRule(), screening, makeMeta({ title: "作品" })).matches).toBe(
      true,
    );
  });

  it("checks formats and the performance id from the URL", () => {
    const screening = makeScreening({ movieTitle: "作品【字幕】", formatLabels: ["字幕"] });
    expect(
      verifyPurchaseMeta(
        makeRule({ movieTitlePattern: "作品" }),
        screening,
        makeMeta({
          title: "作品【字幕】",
          raw: {
            theaterScreen: "グランドシネマサンシャイン 池袋 / シアター１",
            dateTime: "2026年09月18日(金) 10:00",
            title: "作品【字幕】",
          },
        }),
      ).matches,
    ).toBe(true);

    expect(
      verifyPurchaseMeta(
        makeRule(),
        makeScreening(),
        makeMeta({ performanceIdFromUrl: "different-id" }),
      ).matches,
    ).toBe(false);
  });
});

describe("SeatAssistService", () => {
  function makeDeps(map: Partial<AssistSeatMapResult>): {
    deps: SeatAssistDeps;
    highlight: ReturnType<typeof vi.fn>;
  } {
    const highlight = vi.fn(async (seats: readonly Seat[]) =>
      seats.map((seat) => `${seat.row}${seat.number}`.toUpperCase()),
    );
    return {
      highlight,
      deps: {
        openSeatMap: async () => ({
          state: "ready",
          seats: [],
          legend: [],
          screenSide: "top",
          meta: makeMeta(),
          ...map,
        }),
        highlight,
      },
    };
  }

  it("stops before opening the seat page when the screening does not match", async () => {
    const openSeatMap = vi.fn();
    const service = new SeatAssistService({ openSeatMap, highlight: vi.fn() });

    const outcome = await service.assist(
      makeRule(),
      makeScreening({ movieTitle: "全然違うタイトル" }),
    );

    expect(outcome.state).toBe("no_match");
    expect(openSeatMap).not.toHaveBeenCalled();
  });

  it("stops when the purchase page metadata does not match", async () => {
    const { deps, highlight } = makeDeps({ meta: makeMeta({ title: "別の映画" }) });
    const outcome = await new SeatAssistService(deps).assist(makeRule(), makeScreening());
    expect(outcome.state).toBe("no_match");
    expect(highlight).not.toHaveBeenCalled();
  });

  it("highlights the best group and asks the user to act, without clicking", async () => {
    const seats = [
      makeSeat("C", 3),
      makeSeat("C", 4),
      makeSeat("C", 5, { available: false, selectable: false }),
      makeSeat("D", 3),
      makeSeat("D", 4),
    ];
    const { deps, highlight } = makeDeps({ seats });
    const service = new SeatAssistService(deps);

    const outcome = await service.assist(makeRule({ ticketCount: 2 }), makeScreening());

    expect(outcome.state).toBe("user_action_required");
    expect(outcome.group?.seats.map((seat) => `${seat.row}${seat.number}`)).toEqual(["D3", "D4"]);
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledWith(outcome.group?.seats);
  });

  it("fails safe when the highlight does not match the recommendation", async () => {
    const seats = [makeSeat("D", 3), makeSeat("D", 4)];
    const deps: SeatAssistDeps = {
      openSeatMap: async () => ({
        state: "ready",
        seats,
        legend: [],
        screenSide: "top",
        meta: makeMeta(),
      }),
      highlight: async () => ["D3"],
    };
    const outcome = await new SeatAssistService(deps).assist(
      makeRule({ ticketCount: 2 }),
      makeScreening(),
    );
    expect(outcome.state).toBe("site_changed");

    const duplicate: SeatAssistDeps = {
      ...deps,
      highlight: async () => ["D3", "D4", "D4"],
    };
    expect(
      (await new SeatAssistService(duplicate).assist(makeRule({ ticketCount: 2 }), makeScreening()))
        .state,
    ).toBe("site_changed");
  });

  it("surfaces diagnostics on a site_changed seat map", async () => {
    const deps: SeatAssistDeps = {
      openSeatMap: async () => ({
        state: "site_changed",
        seats: [],
        legend: [],
        screenSide: "unknown",
        diagnostics: "seat map timeout apiFree=281 available=0",
      }),
      highlight: async () => [],
    };
    const outcome = await new SeatAssistService(deps).assist(makeRule(), makeScreening());
    expect(outcome.state).toBe("site_changed");
    expect(outcome.reasons?.[0]).toContain("apiFree=281");
  });

  it("passes through login_required and other page anomalies", async () => {
    const login = makeDeps({ state: "login_required" });
    expect(
      (await new SeatAssistService(login.deps).assist(makeRule(), makeScreening())).state,
    ).toBe("login_required");
    expect(login.highlight).not.toHaveBeenCalled();

    const duplicate = makeDeps({ state: "duplicate_transaction" });
    expect(
      (await new SeatAssistService(duplicate.deps).assist(makeRule(), makeScreening())).state,
    ).toBe("duplicate_transaction");
  });

  it("fails safe when the screen direction is unknown", async () => {
    const { deps, highlight } = makeDeps({ screenSide: "unknown" });
    const outcome = await new SeatAssistService(deps).assist(makeRule(), makeScreening());
    expect(outcome.state).toBe("site_changed");
    expect(highlight).not.toHaveBeenCalled();
  });

  it("reports sold_out when no allowed seat group satisfies the rule", async () => {
    const seats = [
      makeSeat("C", 3, {
        seatType: "premiumClass",
        priceCategory: "プレミアム",
        surchargeYen: 1600,
      }),
      makeSeat("C", 4, {
        seatType: "premiumClass",
        priceCategory: "プレミアム",
        surchargeYen: 1600,
      }),
    ];
    const { deps, highlight } = makeDeps({ seats });
    const outcome = await new SeatAssistService(deps).assist(
      makeRule({ ticketCount: 2 }),
      makeScreening(),
    );
    expect(outcome.state).toBe("sold_out");
    expect(highlight).not.toHaveBeenCalled();
  });
});
