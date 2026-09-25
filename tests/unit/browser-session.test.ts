import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vitest";
import {
  BrowserUnavailableError,
  buildLoginUrl,
  type ChromiumLauncher,
  checkLogin,
  hostOf,
  isAuthHost,
  isLoginHost,
  isTransactionHost,
  launchPersistentContext,
  type PersistentLaunchOptions,
  waitForLogin,
} from "../../src/adapters/cinemasunshine/browser-session.js";

describe("host checks", () => {
  it("parses hosts and classifies cinema hosts", () => {
    expect(hostOf("https://login.member.cinemasunshine.co.jp/login")).toBe(
      "login.member.cinemasunshine.co.jp",
    );
    expect(hostOf("not a url")).toBe("");
    expect(isLoginHost("https://login.member.cinemasunshine.co.jp/login")).toBe(true);
    expect(isAuthHost("https://auth.smart-theater.com/logout")).toBe(true);
    expect(
      isTransactionHost(
        "https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/0201",
      ),
    ).toBe(true);
    expect(isLoginHost("https://transaction.ticket-cinemasunshine.com/")).toBe(false);
  });

  it("builds the verified /auth URL without a redirect_uri", () => {
    const url = buildLoginUrl();

    expect(url).toBe("https://login.member.cinemasunshine.co.jp/auth");
    expect(url).not.toContain("redirect_uri");
    expect(url).not.toContain("?");
  });
});

describe("waitForLogin", () => {
  it("resolves true once the URL leaves the login and auth hosts", async () => {
    const urls = [
      "https://login.member.cinemasunshine.co.jp/login",
      "https://login.member.cinemasunshine.co.jp/login",
      "https://www.cinemasunshine.co.jp/",
    ];
    let index = 0;
    let current = 0;

    const loggedIn = await waitForLogin(
      { url: () => urls[Math.min(index, urls.length - 1)] ?? "" },
      {
        timeoutMs: 10_000,
        pollMs: 1_000,
        now: () => current,
        sleep: async (ms) => {
          current += ms;
          index += 1;
        },
      },
    );

    expect(loggedIn).toBe(true);
    expect(index).toBe(2);
  });

  it("returns false when the browser page is closed", async () => {
    const loggedIn = await waitForLogin(
      { url: () => "https://login.member.cinemasunshine.co.jp/login", isClosed: () => true },
      { timeoutMs: 10_000, sleep: async () => {} },
    );

    expect(loggedIn).toBe(false);
  });

  it("returns false on timeout while still on the login host", async () => {
    let current = 0;
    const loggedIn = await waitForLogin(
      { url: () => "https://login.member.cinemasunshine.co.jp/login" },
      {
        timeoutMs: 2_000,
        pollMs: 1_000,
        now: () => current,
        sleep: async (ms) => {
          current += ms;
        },
      },
    );

    expect(loggedIn).toBe(false);
  });
});

type FakeContext = {
  state: { closed: boolean; gotos: string[] };
  context: BrowserContext;
};

function makeFakeContext(
  url: string,
  options: { gotoError?: Error; text?: string } = {},
): FakeContext {
  const state = { closed: false, gotos: [] as string[] };
  const page = {
    async goto(target: string): Promise<void> {
      state.gotos.push(target);
      if (options.gotoError !== undefined) throw options.gotoError;
    },
    url: (): string => url,
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
  const context = {
    newPage: async () => page,
  } as unknown as BrowserContext;
  return { state, context };
}

describe("checkLogin", () => {
  it("reports not logged in when it stays on the login host and closes the page", async () => {
    const fake = makeFakeContext("https://login.member.cinemasunshine.co.jp/login");

    const result = await checkLogin(fake.context);

    expect(result.loggedIn).toBe(false);
    expect(result.status).toBe("login_required");
    expect(fake.state.closed).toBe(true);
    expect(fake.state.gotos[0]).toBe("https://login.member.cinemasunshine.co.jp/auth");
    expect(fake.state.gotos[0]).not.toContain("redirect_uri");
  });

  it("reports logged in when it lands outside the login hosts", async () => {
    const fake = makeFakeContext("https://member.cinemasunshine.co.jp/");

    const result = await checkLogin(fake.context);

    expect(result.loggedIn).toBe(true);
    expect(result.status).toBe("logged_in");
    expect(result.finalUrl).toBe("https://member.cinemasunshine.co.jp/");
  });

  it("does not treat an auth error page outside the login host as logged in", async () => {
    const fake = makeFakeContext("https://member.cinemasunshine.co.jp/error", {
      text: "現在アクセス集中により混雑しております。イベント情報取得エラー [E-ID: x][didMountAuthPage]",
    });

    const result = await checkLogin(fake.context);

    expect(result.loggedIn).toBe(false);
    expect(result.status).toBe("auth_error");
  });

  it("still closes the page and propagates navigation errors", async () => {
    const fake = makeFakeContext("https://login.member.cinemasunshine.co.jp/login", {
      gotoError: new Error("net::ERR_FAILED"),
    });

    await expect(checkLogin(fake.context)).rejects.toThrow("net::ERR_FAILED");
    expect(fake.state.closed).toBe(true);
  });
});

type FakeLauncher = {
  calls: { dir: string; options: PersistentLaunchOptions | undefined }[];
  launcher: ChromiumLauncher;
};

function makeFakeLauncher(error?: Error): FakeLauncher {
  const calls: { dir: string; options: PersistentLaunchOptions | undefined }[] = [];
  const launcher: ChromiumLauncher = {
    async launchPersistentContext(dir, options) {
      calls.push({ dir, options });
      if (error !== undefined) throw error;
      return {} as BrowserContext;
    },
  };
  return { calls, launcher };
}

describe("launchPersistentContext", () => {
  let profileDir: string;

  it("uses the system Chrome channel and does not override the user agent", async () => {
    profileDir = mkdtempSync(join(tmpdir(), "cinema-browser-"));
    const { calls, launcher } = makeFakeLauncher();

    await launchPersistentContext({ profileDir, headless: false, launcher });

    const options = calls[0]?.options ?? {};
    expect(calls[0]?.dir).toBe(profileDir);
    expect(options.channel).toBe("chrome");
    expect(Object.hasOwn(options, "userAgent")).toBe(false);
    expect(options.headless).toBe(false);

    rmSync(profileDir, { recursive: true, force: true });
  });

  it("honours an explicit channel", async () => {
    profileDir = mkdtempSync(join(tmpdir(), "cinema-browser-"));
    const { calls, launcher } = makeFakeLauncher();

    await launchPersistentContext({
      profileDir,
      headless: true,
      channel: "chromium",
      launcher,
    });

    expect(calls[0]?.options?.channel).toBe("chromium");

    rmSync(profileDir, { recursive: true, force: true });
  });

  it("raises a clear error when the browser channel is unavailable", async () => {
    profileDir = mkdtempSync(join(tmpdir(), "cinema-browser-"));
    const { launcher } = makeFakeLauncher(
      new Error("Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app"),
    );

    await expect(
      launchPersistentContext({ profileDir, headless: false, launcher }),
    ).rejects.toBeInstanceOf(BrowserUnavailableError);

    rmSync(profileDir, { recursive: true, force: true });
  });

  it("propagates unrelated launch errors", async () => {
    profileDir = mkdtempSync(join(tmpdir(), "cinema-browser-"));
    const { launcher } = makeFakeLauncher(new Error("profile is locked"));

    await expect(
      launchPersistentContext({ profileDir, headless: false, launcher }),
    ).rejects.toThrow("profile is locked");

    rmSync(profileDir, { recursive: true, force: true });
  });
});
