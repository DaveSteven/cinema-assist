import { z } from "zod";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export type AppConfig = {
  readonly theaterCode: "020";
  readonly timezone: "Asia/Tokyo";
  readonly logLevel: LogLevel;
  readonly dbPath: string;
  readonly browserProfileDir: string;
  readonly browserChannel: string;
  readonly headless: boolean;
  readonly telegram?: {
    readonly botToken: string;
    readonly chatId: string;
  };
};

const BOOLEAN_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no", "off"]);

const booleanish = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value.trim() === "") return false;
    const normalized = value.trim().toLowerCase();
    if (BOOLEAN_TRUE.has(normalized)) return true;
    if (BOOLEAN_FALSE.has(normalized)) return false;
    ctx.addIssue({
      code: "custom",
      message: `expected a boolean-like value, received "${value}"`,
    });
    return z.NEVER;
  });

const rawConfigSchema = z
  .object({
    theaterCode: z.literal("020").default("020"),
    timezone: z.literal("Asia/Tokyo").default("Asia/Tokyo"),
    logLevel: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    dbPath: z.string().min(1).default("./data/cinema-assist.sqlite"),
    browserProfileDir: z.string().min(1).default("./.auth/profile"),
    browserChannel: z.string().min(1).default("chrome"),
    headless: booleanish,
    telegramBotToken: z.string().min(1).optional(),
    telegramChatId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasToken = value.telegramBotToken !== undefined;
    const hasChatId = value.telegramChatId !== undefined;
    if (hasToken !== hasChatId) {
      ctx.addIssue({
        code: "custom",
        message: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together",
        path: hasToken ? ["telegramChatId"] : ["telegramBotToken"],
      });
    }
  });

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawConfigSchema.safeParse({
    theaterCode: read(env, "THEATER_CODE"),
    timezone: read(env, "TIMEZONE"),
    logLevel: read(env, "LOG_LEVEL"),
    dbPath: read(env, "DB_PATH"),
    browserProfileDir: read(env, "BROWSER_PROFILE_DIR"),
    browserChannel: read(env, "BROWSER_CHANNEL"),
    headless: read(env, "HEADLESS"),
    telegramBotToken: read(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: read(env, "TELEGRAM_CHAT_ID"),
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }

  const data = parsed.data;
  const telegram =
    data.telegramBotToken !== undefined && data.telegramChatId !== undefined
      ? { botToken: data.telegramBotToken, chatId: data.telegramChatId }
      : undefined;

  return {
    theaterCode: data.theaterCode,
    timezone: data.timezone,
    logLevel: data.logLevel,
    dbPath: data.dbPath,
    browserProfileDir: data.browserProfileDir,
    browserChannel: data.browserChannel,
    headless: data.headless,
    ...(telegram !== undefined ? { telegram } : {}),
  };
}

export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    theaterCode: config.theaterCode,
    timezone: config.timezone,
    logLevel: config.logLevel,
    dbPath: config.dbPath,
    browserProfileDir: config.browserProfileDir,
    browserChannel: config.browserChannel,
    headless: config.headless,
    telegramConfigured: config.telegram !== undefined,
  };
}
