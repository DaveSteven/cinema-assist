import { jstDateTimeIso, shiftIsoDate, toJstIsoString } from "../domain/time.js";
import type { MemberTier, WatchRule } from "../domain/watch-rule.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export type SaleWindowHint = {
  targetDate: string;
  memberTier?: MemberTier;
  saleOpensAtOverride?: string;
};

export const MEMBER_TIER_OPEN: Record<
  MemberTier,
  { daysBefore: number; hour: number; minute: number }
> = {
  platinum: { daysBefore: 3, hour: 20, minute: 30 },
  bronze: { daysBefore: 3, hour: 21, minute: 0 },
  gold: { daysBefore: 3, hour: 21, minute: 0 },
  none: { daysBefore: 2, hour: 0, minute: 0 },
};

export function expectedSaleOpensAt(hint: SaleWindowHint): string {
  if (hint.saleOpensAtOverride !== undefined) {
    return toJstIsoString(hint.saleOpensAtOverride);
  }
  const tier = hint.memberTier ?? "none";
  const preset = MEMBER_TIER_OPEN[tier];
  const date = shiftIsoDate(hint.targetDate, -preset.daysBefore);
  return jstDateTimeIso(date, preset.hour, preset.minute);
}

export function expectedSaleOpensAtForRule(
  rule: Pick<WatchRule, "targetDate" | "memberTier" | "saleOpensAtOverride">,
): string {
  return expectedSaleOpensAt({
    targetDate: rule.targetDate,
    memberTier: rule.memberTier,
    saleOpensAtOverride: rule.saleOpensAtOverride,
  });
}

export type PollPhase = "far" | "approaching" | "near" | "imminent" | "due" | "overdue";

export type PollSchedule = {
  phase: PollPhase;
  intervalMs: number;
};

export function pollSchedule(expectedOpensAt: string, now: Date): PollSchedule {
  const opensAt = Date.parse(expectedOpensAt);
  if (Number.isNaN(opensAt)) {
    throw new Error(`Invalid expectedOpenAt: ${expectedOpensAt}`);
  }
  const diff = opensAt - now.getTime();

  if (diff > 6 * HOUR) return { phase: "far", intervalMs: 10 * MINUTE };
  if (diff > 10 * MINUTE) return { phase: "approaching", intervalMs: 2 * MINUTE };
  if (diff > 1 * MINUTE) return { phase: "near", intervalMs: 30 * SECOND };
  if (diff > 0) return { phase: "imminent", intervalMs: 10 * SECOND };
  if (diff >= -2 * MINUTE) return { phase: "due", intervalMs: 3 * SECOND };
  return { phase: "overdue", intervalMs: 2 * MINUTE };
}

export function backoffWithJitter(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const baseMs = options.baseMs ?? 3 * SECOND;
  const maxMs = options.maxMs ?? 5 * MINUTE;
  const random = options.random ?? Math.random;
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
  const jitter = Math.floor(random() * Math.min(1_000, exponential));
  return exponential + jitter;
}
