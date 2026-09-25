import { describe, expect, it } from "vitest";
import {
  parseDateText,
  parsePerformanceIdFromUrl,
  parsePurchaseMeta,
} from "../../src/adapters/cinemasunshine/purchase-meta.js";

describe("parseDateText", () => {
  it("parses the japanese date-time text", () => {
    expect(parseDateText("2026年09月27日(日) 18:25 - 20:42")).toEqual({
      date: "2026-09-27",
      startTime: "18:25",
      endTime: "20:42",
    });
    expect(parseDateText("2026年9月7日(月) 9:05")).toEqual({
      date: "2026-09-07",
      startTime: "09:05",
    });
  });

  it("returns nothing for unparseable text", () => {
    expect(parseDateText("no date here")).toEqual({});
  });
});

describe("parsePurchaseMeta", () => {
  it("splits theater and screen and keeps raw text", () => {
    const meta = parsePurchaseMeta({
      theaterScreen: "グランドシネマサンシャイン 池袋 / シアター７",
      dateTime: "2026年09月27日(日) 18:25 - 20:42",
      title: "ブルーロック",
    });

    expect(meta.theaterName).toBe("グランドシネマサンシャイン 池袋");
    expect(meta.screenName).toBe("シアター７");
    expect(meta.title).toBe("ブルーロック");
    expect(meta.date).toBe("2026-09-27");
    expect(meta.startTime).toBe("18:25");
    expect(meta.raw.theaterScreen).toContain("シアター７");
  });
});

describe("parsePerformanceIdFromUrl", () => {
  const id = "02028525020260918901105";

  it("extracts the id from the official transaction path", () => {
    expect(
      parsePerformanceIdFromUrl(
        `https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/${id}`,
      ),
    ).toBe(id);
  });

  it("extracts the id from the query parameter", () => {
    expect(
      parsePerformanceIdFromUrl(
        `https://transaction.ticket-cinemasunshine.com/?performanceId=${id}`,
      ),
    ).toBe(id);
  });

  it("prefers a valid query id but ignores a malformed one", () => {
    expect(
      parsePerformanceIdFromUrl(
        `https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/${id}?performanceId=not-an-id`,
      ),
    ).toBe(id);
  });

  it("rejects a non-official host, wrong path or a missing id", () => {
    expect(
      parsePerformanceIdFromUrl(
        `https://example.com/projects/sskts-production/purchase/transaction/${id}`,
      ),
    ).toBeUndefined();
    expect(
      parsePerformanceIdFromUrl("https://transaction.ticket-cinemasunshine.com/#/purchase/seat"),
    ).toBeUndefined();
    expect(
      parsePerformanceIdFromUrl("https://transaction.ticket-cinemasunshine.com/"),
    ).toBeUndefined();
    expect(parsePerformanceIdFromUrl("not a url")).toBeUndefined();
  });
});
