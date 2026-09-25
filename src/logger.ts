import pino, { type Logger } from "pino";

export type { Logger };

const REDACT_PATHS = [
  "password",
  "token",
  "authorization",
  "cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.token",
  "*.cookie",
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  });
}

export const silentLogger: Logger = pino({ level: "silent", base: undefined });
