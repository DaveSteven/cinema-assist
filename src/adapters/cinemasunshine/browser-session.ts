import { mkdirSync } from "node:fs";
import { type BrowserContext, chromium } from "playwright";
import { AUTH_HOSTS, LOGIN_HOSTS, TEXT_PATTERNS, URLS } from "./selectors.js";

export const DEFAULT_CHANNEL = "chrome";

export type PersistentLaunchOptions = Parameters<typeof chromium.launchPersistentContext>[1];

export type ChromiumLauncher = {
  launchPersistentContext: (
    userDataDir: string,
    options?: PersistentLaunchOptions,
  ) => Promise<BrowserContext>;
};

export type PersistentContextOptions = {
  profileDir: string;
  headless: boolean;
  channel?: string;
  locale?: string;
  launcher?: ChromiumLauncher;
};

export class BrowserUnavailableError extends Error {
  constructor(channel: string, cause: unknown) {
    super(
      `无法启动浏览器 channel "${channel}"。请安装稳定版 Google Chrome，或通过 BROWSER_CHANNEL 指定其他可用 channel。`,
    );
    this.name = "BrowserUnavailableError";
    this.cause = cause;
  }
}

function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /chrome|chromium/i.test(message) &&
    /not found|not installed|doesn't exist|executable/i.test(message)
  );
}

export async function launchPersistentContext(
  options: PersistentContextOptions,
): Promise<BrowserContext> {
  mkdirSync(options.profileDir, { recursive: true });
  const launcher = options.launcher ?? (chromium as ChromiumLauncher);
  const channel = options.channel ?? DEFAULT_CHANNEL;

  try {
    return await launcher.launchPersistentContext(options.profileDir, {
      headless: options.headless,
      channel,
      locale: options.locale ?? "ja-JP",
      viewport: { width: 1280, height: 900 },
    });
  } catch (error) {
    if (isMissingBrowserError(error)) {
      throw new BrowserUnavailableError(channel, error);
    }
    throw error;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function isLoginHost(url: string): boolean {
  return (LOGIN_HOSTS as readonly string[]).includes(hostOf(url));
}

export function isAuthHost(url: string): boolean {
  return (AUTH_HOSTS as readonly string[]).includes(hostOf(url));
}

export function isTransactionHost(url: string): boolean {
  return hostOf(url) === new URL(URLS.transactionOrigin).host;
}

export function buildLoginUrl(): string {
  return `${URLS.loginOrigin}${URLS.authPath}`;
}

export type UrlSource = {
  url(): string;
  isClosed?(): boolean;
};

export type WaitForLoginOptions = {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function waitForLogin(
  source: UrlSource,
  options: WaitForLoginOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const pollMs = options.pollMs ?? 1_000;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (source.isClosed?.() === true) return false;
    if (!isLoginHost(source.url()) && !isAuthHost(source.url())) return true;
    await sleep(pollMs);
  }

  return !isLoginHost(source.url()) && !isAuthHost(source.url());
}

export type LoginCheckStatus = "logged_in" | "login_required" | "auth_error";

export type LoginCheckResult = {
  loggedIn: boolean;
  status: LoginCheckStatus;
  finalUrl: string;
};

function matchesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export async function checkLogin(
  context: BrowserContext,
  options: { timeoutMs?: number } = {},
): Promise<LoginCheckResult> {
  const page = await context.newPage();
  try {
    await page.goto(buildLoginUrl(), {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    const finalUrl = page.url();
    const text =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || "";

    if (isLoginHost(finalUrl) || isAuthHost(finalUrl)) {
      return { loggedIn: false, status: "login_required", finalUrl };
    }
    if (matchesAny(text, TEXT_PATTERNS.authError)) {
      return { loggedIn: false, status: "auth_error", finalUrl };
    }
    return { loggedIn: true, status: "logged_in", finalUrl };
  } finally {
    await page.close().catch(() => {});
  }
}
