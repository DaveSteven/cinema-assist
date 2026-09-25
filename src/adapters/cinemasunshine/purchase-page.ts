import type { Page } from "playwright";
import { buildLoginUrl, isAuthHost, isLoginHost, isTransactionHost } from "./browser-session.js";
import { TEXT_PATTERNS, URLS } from "./selectors.js";

export type PurchasePageState =
  | "ready"
  | "login_required"
  | "session_expired"
  | "congested"
  | "duplicate_transaction"
  | "error"
  | "site_changed";

const PERFORMANCE_ID_PATTERN = /^\d{23,24}$/;

export class InvalidPerformanceIdError extends Error {
  constructor(performanceId: string) {
    super(`Invalid performance id: ${JSON.stringify(performanceId)}`);
    this.name = "InvalidPerformanceIdError";
  }
}

export function isValidPerformanceId(performanceId: string): boolean {
  return PERFORMANCE_ID_PATTERN.test(performanceId);
}

export function buildPurchaseUrl(performanceId: string): string {
  if (!isValidPerformanceId(performanceId)) {
    throw new InvalidPerformanceIdError(performanceId);
  }
  return `${URLS.purchaseBase}/${performanceId}`;
}

function routeOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.hash}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function classifyPurchaseRoute(route: string): PurchasePageState | undefined {
  if (route.includes("/purchase/overlap")) return "duplicate_transaction";
  if (route.includes("/expired")) return "session_expired";
  if (route.includes("/congestion")) return "congested";
  if (route.includes("/error")) return "error";
  if (/\/purchase\/(transaction|seat|ticket|input|confirm|complete)/.test(route)) return "ready";
  return undefined;
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function detectPurchasePageState(input: { url: string; text: string }): PurchasePageState {
  const url = input.url;

  if (isLoginHost(url) || isAuthHost(url)) return "login_required";
  if (!isTransactionHost(url)) return "site_changed";

  const routeState = classifyPurchaseRoute(routeOf(url));
  if (routeState !== undefined) return routeState;

  const text = normalizeText(input.text);
  if (matchesAny(text, TEXT_PATTERNS.sessionExpired)) return "session_expired";
  if (matchesAny(text, TEXT_PATTERNS.congested)) return "congested";
  if (matchesAny(text, TEXT_PATTERNS.duplicateTransaction)) return "duplicate_transaction";
  if (matchesAny(text, TEXT_PATTERNS.error)) return "error";

  return "site_changed";
}

export type PurchaseInspection = {
  state: PurchasePageState;
  url: string;
  text: string;
};

export type PurchasePageOptions = {
  navigationTimeoutMs?: number;
  settleMs?: number;
  preflightLogin?: boolean;
};

export class PurchasePage {
  constructor(
    private readonly page: Page,
    private readonly options: PurchasePageOptions = {},
  ) {}

  async openPurchase(performanceId: string): Promise<PurchaseInspection> {
    const purchaseUrl = buildPurchaseUrl(performanceId);

    if (this.options.preflightLogin !== false) {
      await this.navigate(buildLoginUrl());
      const gate = await this.inspect();
      if (gate.state === "login_required") {
        return gate;
      }
    }

    await this.navigate(purchaseUrl);
    return this.inspect();
  }

  async inspect(): Promise<PurchaseInspection> {
    const url = this.page.url();
    const text = await this.page
      .locator("body")
      .innerText()
      .catch(() => "");
    return { url, text, state: detectPurchasePageState({ url, text }) };
  }

  private async navigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.options.navigationTimeoutMs ?? 45_000,
    });
    await this.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await this.page.waitForTimeout(this.options.settleMs ?? 1_500);
  }
}
