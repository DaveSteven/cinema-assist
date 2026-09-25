import type { Screening } from "../domain/screening.js";
import type { WatchRule } from "../domain/watch-rule.js";

export type NotificationEvent =
  | { type: "started"; rule: WatchRule; expectedSaleOpensAt: string }
  | { type: "waiting_for_schedule"; rule: WatchRule }
  | { type: "waiting_for_sale"; rule: WatchRule; screening: Screening; expectedSaleOpensAt: string }
  | { type: "sales_open"; rule: WatchRule; screening: Screening }
  | { type: "sold_out"; rule: WatchRule; screening: Screening }
  | { type: "no_match"; rule: WatchRule; reason?: string }
  | { type: "rate_limited"; rule: WatchRule; message: string }
  | { type: "error"; rule: WatchRule; message: string }
  | { type: "cancelled"; rule: WatchRule };

export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

export class NotificationService {
  private readonly sent = new Set<string>();

  constructor(private readonly notifier: Notifier) {}

  async notify(key: string, event: NotificationEvent): Promise<boolean> {
    if (this.sent.has(key)) {
      return false;
    }
    await this.notifier.notify(event);
    this.sent.add(key);
    return true;
  }

  hasSent(key: string): boolean {
    return this.sent.has(key);
  }
}
