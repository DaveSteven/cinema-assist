import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  buildPurchaseUrl,
  detectPurchasePageState,
  InvalidPerformanceIdError,
  isValidPerformanceId,
  PurchasePage,
} from "../../src/adapters/cinemasunshine/purchase-page.js";

const PERFORMANCE_ID = "02029222230260929101000";
const PURCHASE_URL = `https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/${PERFORMANCE_ID}`;

describe("buildPurchaseUrl", () => {
  it("accepts real 23- and 24-digit performance ids", () => {
    expect(isValidPerformanceId("02026479020260918700800")).toBe(true);
    expect(isValidPerformanceId("020284530202609181011310")).toBe(true);
    expect(buildPurchaseUrl(PERFORMANCE_ID)).toBe(PURCHASE_URL);
  });

  it.each([
    "",
    "abc",
    "0202922223026092910100",
    "0202922223026092910100000",
    "0202922223/0260929101000",
    "02029222230260929101000?x=1",
    "02029222230260929101000#frag",
    "https://example.com/purchase/seat",
  ])("rejects an invalid performance id %j", (value) => {
    expect(() => buildPurchaseUrl(value)).toThrow(InvalidPerformanceIdError);
  });
});

describe("detectPurchasePageState", () => {
  it("detects a login redirect", () => {
    expect(
      detectPurchasePageState({
        url: "https://login.member.cinemasunshine.co.jp/login?redirect_uri=x",
        text: "",
      }),
    ).toBe("login_required");
    expect(
      detectPurchasePageState({ url: "https://auth.smart-theater.com/logout", text: "" }),
    ).toBe("login_required");
  });

  it("classifies confirmed transaction routes even with an empty body", () => {
    const cases: [string, string][] = [
      ["#/purchase/overlap", "duplicate_transaction"],
      ["#/expired", "session_expired"],
      ["#/congestion", "congested"],
      ["#/error", "error"],
      ["#/purchase/seat", "ready"],
      ["#/purchase/ticket", "ready"],
      ["#/purchase/input", "ready"],
      ["#/purchase/confirm", "ready"],
      ["#/purchase/transaction", "ready"],
    ];
    for (const [fragment, expected] of cases) {
      expect(
        detectPurchasePageState({
          url: `https://transaction.ticket-cinemasunshine.com/${fragment}`,
          text: "",
        }),
      ).toBe(expected);
    }
  });

  it("classifies equivalent non-hash paths", () => {
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/expired",
        text: "",
      }),
    ).toBe("session_expired");
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/purchase/overlap",
        text: "",
      }),
    ).toBe("duplicate_transaction");
  });

  it("gives anomaly routes priority over normal purchase text", () => {
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/#/purchase/overlap",
        text: "座席を選択してください /purchase/seat",
      }),
    ).toBe("duplicate_transaction");
  });

  it("never returns ready on a non-official host", () => {
    expect(detectPurchasePageState({ url: "https://example.com/#/purchase/seat", text: "" })).toBe(
      "site_changed",
    );
    expect(detectPurchasePageState({ url: "https://example.com/#/expired", text: "" })).toBe(
      "site_changed",
    );
  });

  it("does not misread a normal purchase page that mentions 有効期限", () => {
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/#/purchase/seat",
        text: "チケットの有効期限は当日のみです。座席を選択してください。",
      }),
    ).toBe("ready");
  });

  it("falls back to unique text phrases when the route is unknown", () => {
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/",
        text: "セッションの有効期限が切れました。",
      }),
    ).toBe("session_expired");
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/",
        text: "現在アクセスが集中しています。",
      }),
    ).toBe("congested");
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/",
        text: "エラーが発生しました。",
      }),
    ).toBe("error");
  });

  it("falls back to site_changed for an unrecognized transaction page", () => {
    expect(
      detectPurchasePageState({
        url: "https://transaction.ticket-cinemasunshine.com/",
        text: "こんにちは",
      }),
    ).toBe("site_changed");
  });
});

type FakePage = {
  state: { url: string; gotoUrl: string; closed: boolean; gotos: string[] };
  page: Page;
};

const LOGIN_URL = "https://login.member.cinemasunshine.co.jp/auth";

function makeFakePage(options: {
  url: string;
  text?: string;
  gotoError?: Error;
  loginGateUrl?: string;
}): FakePage {
  const state = { url: options.url, gotoUrl: "", closed: false, gotos: [] as string[] };
  const page = {
    async goto(target: string): Promise<void> {
      state.gotoUrl = target;
      state.gotos.push(target);
      if (options.gotoError !== undefined) throw options.gotoError;
      state.url =
        target === LOGIN_URL
          ? (options.loginGateUrl ?? "https://member.cinemasunshine.co.jp/")
          : options.url;
    },
    url: (): string => state.url,
    locator: (_selector: string) => ({
      innerText: async (): Promise<string> => options.text ?? "",
    }),
    waitForLoadState: async (): Promise<void> => {},
    waitForTimeout: async (): Promise<void> => {},
    close: async (): Promise<void> => {
      state.closed = true;
    },
    isClosed: (): boolean => state.closed,
  };
  return { state, page: page as unknown as Page };
}

describe("PurchasePage", () => {
  it("preflights the plain /auth gate and then opens the purchase page", async () => {
    const fake = makeFakePage({ url: PURCHASE_URL, text: "座席を選択してください" });
    const purchase = new PurchasePage(fake.page, { settleMs: 0 });

    const result = await purchase.openPurchase(PERFORMANCE_ID);

    expect(fake.state.gotos[0]).toBe(LOGIN_URL);
    expect(fake.state.gotos[0]).not.toContain("redirect_uri");
    expect(fake.state.gotos[1]).toBe(PURCHASE_URL);
    expect(result.state).toBe("ready");
  });

  it("returns login_required without opening the purchase page when not signed in", async () => {
    const fake = makeFakePage({
      url: PURCHASE_URL,
      loginGateUrl: "https://login.member.cinemasunshine.co.jp/login?redirect_uri=x",
    });
    const purchase = new PurchasePage(fake.page, { settleMs: 0 });

    const result = await purchase.openPurchase(PERFORMANCE_ID);

    expect(result.state).toBe("login_required");
    expect(fake.state.gotos).toEqual([LOGIN_URL]);
  });

  it("does not navigate when the performance id is invalid", async () => {
    const fake = makeFakePage({ url: PURCHASE_URL });
    const purchase = new PurchasePage(fake.page, { settleMs: 0 });

    await expect(purchase.openPurchase("bad-id")).rejects.toBeInstanceOf(InvalidPerformanceIdError);
    expect(fake.state.gotos).toEqual([]);
  });

  it("propagates navigation errors instead of reporting site_changed", async () => {
    const fake = makeFakePage({ url: PURCHASE_URL, gotoError: new Error("net::ERR_FAILED") });
    const purchase = new PurchasePage(fake.page, { settleMs: 0 });

    await expect(purchase.openPurchase(PERFORMANCE_ID)).rejects.toThrow("net::ERR_FAILED");
  });
});
