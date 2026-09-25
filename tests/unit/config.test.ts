import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("applies defaults for an empty environment", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      theaterCode: "020",
      timezone: "Asia/Tokyo",
      logLevel: "info",
      dbPath: "./data/cinema-assist.sqlite",
      browserProfileDir: "./.auth/profile",
      headless: false,
    });
  });

  it("reads and normalizes overrides", () => {
    const config = loadConfig({
      THEATER_CODE: "020",
      TIMEZONE: "Asia/Tokyo",
      LOG_LEVEL: "debug",
      DB_PATH: "/tmp/test.sqlite",
      BROWSER_PROFILE_DIR: "/tmp/profile",
      HEADLESS: "TRUE",
    });

    expect(config.logLevel).toBe("debug");
    expect(config.dbPath).toBe("/tmp/test.sqlite");
    expect(config.browserProfileDir).toBe("/tmp/profile");
    expect(config.headless).toBe(true);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["yes", true],
    ["on", true],
    ["0", false],
    ["false", false],
    ["no", false],
    ["off", false],
  ])("parses HEADLESS=%s as %s", (raw, expected) => {
    expect(loadConfig({ HEADLESS: raw }).headless).toBe(expected);
  });

  it("rejects an invalid boolean", () => {
    expect(() => loadConfig({ HEADLESS: "maybe" })).toThrow(ConfigError);
  });

  it("rejects an unsupported theater code", () => {
    expect(() => loadConfig({ THEATER_CODE: "999" })).toThrow(ConfigError);
  });

  it("rejects a partial telegram configuration", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "token" })).toThrow(ConfigError);
    expect(() => loadConfig({ TELEGRAM_CHAT_ID: "chat" })).toThrow(ConfigError);
  });

  it("exposes complete telegram configuration", () => {
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" });

    expect(config.telegram).toEqual({ botToken: "token", chatId: "chat" });
    expect(describeConfig(config).telegramConfigured).toBe(true);
    expect(JSON.stringify(describeConfig(config))).not.toContain("token");
  });
});
