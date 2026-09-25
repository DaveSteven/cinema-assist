import { describe, expect, it } from "vitest";
import { parseWatchRuleInput } from "../../src/domain/watch-rule.js";
import {
  type NotificationEvent,
  NotificationService,
  type Notifier,
} from "../../src/services/notification-service.js";

const rule = {
  ...parseWatchRuleInput({ movieTitlePattern: "X", targetDate: "2026-09-29" }),
  id: "rule-1",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const event: NotificationEvent = { type: "waiting_for_schedule", rule };

describe("NotificationService", () => {
  it("delivers once and suppresses duplicate keys", async () => {
    const delivered: NotificationEvent[] = [];
    const notifier: Notifier = {
      notify(value): Promise<void> {
        delivered.push(value);
        return Promise.resolve();
      },
    };
    const service = new NotificationService(notifier);

    await expect(service.notify("k", event)).resolves.toBe(true);
    await expect(service.notify("k", event)).resolves.toBe(false);
    expect(delivered).toHaveLength(1);
    expect(service.hasSent("k")).toBe(true);
  });

  it("retries after a notifier failure instead of marking the key as sent", async () => {
    let attempts = 0;
    const delivered: NotificationEvent[] = [];
    const notifier: Notifier = {
      notify(value): Promise<void> {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error("boom"));
        }
        delivered.push(value);
        return Promise.resolve();
      },
    };
    const service = new NotificationService(notifier);

    await expect(service.notify("k", event)).rejects.toThrow("boom");
    expect(service.hasSent("k")).toBe(false);

    await expect(service.notify("k", event)).resolves.toBe(true);
    expect(attempts).toBe(2);
    expect(delivered).toHaveLength(1);

    await expect(service.notify("k", event)).resolves.toBe(false);
    expect(attempts).toBe(2);
  });
});
