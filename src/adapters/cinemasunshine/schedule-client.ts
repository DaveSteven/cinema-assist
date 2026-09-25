import type { ZodType } from "zod";
import type {
  DaySchedule,
  MaintenanceInfo,
  ScheduleIndex,
  TheaterIndex,
} from "./schedule-schema.js";
import {
  dayScheduleSchema,
  maintenanceSchema,
  scheduleIndexSchema,
  theatersSchema,
} from "./schedule-schema.js";

export const DEFAULT_BASE_URL = "https://www.cinemasunshine.co.jp";
export const DEFAULT_USER_AGENT = "cinema-assist/0.1 (local single-user ticket assistant)";

export class HttpError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, message?: string) {
    super(message ?? `HTTP ${status} for ${path}`);
    this.name = "HttpError";
    this.status = status;
    this.path = path;
  }
}

export class ScheduleValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid schedule payload for ${path}: ${message}`);
    this.name = "ScheduleValidationError";
    this.path = path;
  }
}

export class ScheduleParseError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(`Response for ${path} is not valid JSON`);
    this.name = "ScheduleParseError";
    this.path = path;
    this.cause = cause;
  }
}

export type ScheduleClientOptions = {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class ScheduleClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: ScheduleClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  fetchScheduleIndex(): Promise<ScheduleIndex> {
    return this.getJson("/schedule/data/schedule.json", scheduleIndexSchema);
  }

  fetchTheaters(): Promise<TheaterIndex> {
    return this.getJson("/schedule/data/theaters.json", theatersSchema);
  }

  fetchMaintenance(): Promise<MaintenanceInfo> {
    return this.getJson("/schedule/data/maintenance.json", maintenanceSchema);
  }

  fetchDaySchedule(
    movieCode: string,
    theaterCode: string,
    date: string,
  ): Promise<DaySchedule | null> {
    return this.getJson(
      `/schedule/data/${movieCode}/${theaterCode}/${date}.json`,
      dayScheduleSchema,
      {
        allowNotFound: true,
      },
    );
  }

  private async getJson<T>(path: string, schema: ZodType<T>): Promise<T>;
  private async getJson<T>(
    path: string,
    schema: ZodType<T>,
    options: { allowNotFound: true },
  ): Promise<T | null>;
  private async getJson<T>(
    path: string,
    schema: ZodType<T>,
    options?: { allowNotFound?: boolean },
  ): Promise<T | null> {
    const raw = await this.request(path, options?.allowNotFound ?? false);
    if (raw === null) return null;

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ScheduleValidationError(path, parsed.error.message);
    }
    return parsed.data;
  }

  private async request(path: string, allowNotFound: boolean): Promise<unknown | null> {
    const url = `${this.baseUrl}${path}?v=${this.now()}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.backoffMs(attempt));
      }
      try {
        const response = await this.fetchOnce(url);
        if (response.status === 404) {
          if (allowNotFound) return null;
          throw new HttpError(404, path);
        }
        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < this.maxRetries) {
            lastError = new HttpError(response.status, path);
            continue;
          }
          throw new HttpError(response.status, path);
        }
        return await this.readJson(response, path);
      } catch (error) {
        if (error instanceof HttpError) {
          if (this.isRetryableStatus(error.status) && attempt < this.maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }
        if (error instanceof ScheduleParseError) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async readJson(response: Response, path: string): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new ScheduleParseError(path, error);
    }
  }

  private async fetchOnce(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { "user-agent": this.userAgent, accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private backoffMs(attempt: number): number {
    const base = 500 * 2 ** (attempt - 1);
    return base + Math.floor(this.random() * 250);
  }
}
