import { describe, expect, it } from "vitest";
import {
  HttpError,
  ScheduleClient,
  type ScheduleClientOptions,
  ScheduleParseError,
  ScheduleValidationError,
} from "../../src/adapters/cinemasunshine/schedule-client.js";

const INDEX_BODY = {
  "2852500": {
    "020": {
      "20260918": {
        "1105": [
          {
            branchCode: "90",
            availabilityStarts: "2026-09-09T00:00:00+0900",
            availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
          },
        ],
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init: RequestInit | undefined };

function makeClient(
  responses: readonly (Response | (() => Promise<Response> | Response))[],
  overrides: Partial<ScheduleClientOptions> = {},
): { client: ScheduleClient; calls: Call[]; sleeps: number[] } {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected fetch call");
    return typeof next === "function" ? await next() : next;
  }) as typeof fetch;

  const client = new ScheduleClient({
    baseUrl: "https://example.test",
    userAgent: "ua-test",
    now: () => 123,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl,
    ...overrides,
  });

  return { client, calls, sleeps };
}

describe("ScheduleClient", () => {
  it("fetches and validates the schedule index with cache-buster and user-agent", async () => {
    const { client, calls } = makeClient([jsonResponse(INDEX_BODY)]);

    const index = await client.fetchScheduleIndex();

    expect(index["2852500"]?.["020"]?.["20260918"]?.["1105"]?.[0]?.branchCode).toBe("90");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/schedule/data/schedule.json?v=123");
    expect(calls[0]?.init?.headers).toMatchObject({ "user-agent": "ua-test" });
  });

  it("returns null for a 404 day schedule without retrying", async () => {
    const { client, calls, sleeps } = makeClient([new Response("not found", { status: 404 })]);

    await expect(client.fetchDaySchedule("2852500", "020", "20260101")).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries retryable statuses and succeeds", async () => {
    const { client, calls, sleeps } = makeClient(
      [new Response("boom", { status: 500 }), jsonResponse(INDEX_BODY)],
      { maxRetries: 2 },
    );

    await expect(client.fetchScheduleIndex()).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it("gives up after exhausting retries on 429", async () => {
    const { client, calls } = makeClient(
      [new Response("slow down", { status: 429 }), new Response("slow down", { status: 429 })],
      { maxRetries: 1 },
    );

    await expect(client.fetchScheduleIndex()).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a non-retryable error", async () => {
    const { client, calls } = makeClient([new Response("forbidden", { status: 403 })]);

    const error = await client.fetchScheduleIndex().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("throws a validation error when the payload shape is wrong", async () => {
    const { client } = makeClient([jsonResponse({ nope: true })]);

    await expect(client.fetchScheduleIndex()).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it("wraps invalid JSON as a parse error with the request path", async () => {
    const { client } = makeClient([new Response("<html>oops</html>", { status: 200 })]);

    const error = await client.fetchScheduleIndex().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScheduleParseError);
    expect((error as ScheduleParseError).path).toBe("/schedule/data/schedule.json");
  });

  it("aborts and rejects after the timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    const client = new ScheduleClient({
      baseUrl: "https://example.test",
      now: () => 1,
      maxRetries: 0,
      timeoutMs: 5,
      sleep: async () => {},
      fetchImpl: ((_input: string | URL | Request, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }) as typeof fetch,
    });

    await expect(client.fetchScheduleIndex()).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("retries network errors and finally throws the original error", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const client = new ScheduleClient({
      baseUrl: "https://example.test",
      now: () => 1,
      maxRetries: 1,
      random: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        throw new Error("network down");
      }) as typeof fetch,
    });

    await expect(client.fetchScheduleIndex()).rejects.toThrow("network down");
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it("requests only once when maxRetries is zero", async () => {
    const { client, calls } = makeClient([new Response("boom", { status: 500 })], {
      maxRetries: 0,
    });

    await expect(client.fetchScheduleIndex()).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it("preserves unknown fields from the payload", async () => {
    const body = {
      "0123456": {
        "012": {
          "20260918": {
            "1000": [
              {
                branchCode: "10",
                availabilityStarts: "2026-09-09T00:00:00+0900",
                availabilityStartsToMembers: "2026-09-09T00:00:00+0900",
                customDiagnostic: "preserve-me",
              },
            ],
          },
        },
      },
    };
    const { client } = makeClient([jsonResponse(body)]);

    const index = await client.fetchScheduleIndex();
    const entry = index["0123456"]?.["012"]?.["20260918"]?.["1000"]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(entry?.customDiagnostic).toBe("preserve-me");
  });
});
