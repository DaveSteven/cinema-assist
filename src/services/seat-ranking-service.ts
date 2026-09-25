import type { Seat, SeatGroup } from "../domain/seat.js";

export type SeatRankingOptions = {
  ticketCount: number;
  requireAdjacent: boolean;
  preferredRows?: readonly string[];
  excludedRows?: readonly string[];
  preferredSeatNumbers?: readonly number[];
  allowedSeatTypes?: readonly string[];
  excludedSeatTypes?: readonly string[];
  maxSurchargeYen?: number;
  aislePreference?: "none" | "prefer" | "avoid";
  screenSide: "top" | "bottom";
  targetRowRatio?: number;
  minScore?: number;
};

export const DEFAULT_TARGET_ROW_RATIO = 0.65;
export const DEFAULT_ALLOWED_SEAT_TYPES = ["standard"] as const;
export const DEFAULT_MAX_SURCHARGE_YEN = 0;

export type SeatTypeSummary = {
  seatType: string;
  priceCategory?: string;
  surchargeYen?: number;
  available: number;
  total: number;
};

export type SeatSummary = {
  total: number;
  available: number;
  selectable: number;
  wheelchair: number;
  byType: SeatTypeSummary[];
};

export function summarizeSeats(seats: readonly Seat[]): SeatSummary {
  const summary: SeatSummary = {
    total: seats.length,
    available: 0,
    selectable: 0,
    wheelchair: 0,
    byType: [],
  };
  const types = new Map<string, SeatTypeSummary>();

  for (const seat of seats) {
    if (seat.available) summary.available += 1;
    if (seat.selectable) summary.selectable += 1;
    if (seat.wheelchair) summary.wheelchair += 1;

    const priceKey = `${seat.seatType}|${seat.priceCategory ?? ""}|${
      seat.surchargeYen ?? "unknown"
    }`;
    const existing = types.get(priceKey);
    if (existing === undefined) {
      types.set(priceKey, {
        seatType: seat.seatType,
        ...(seat.priceCategory !== undefined ? { priceCategory: seat.priceCategory } : {}),
        ...(seat.surchargeYen !== undefined ? { surchargeYen: seat.surchargeYen } : {}),
        available: seat.available ? 1 : 0,
        total: 1,
      });
    } else {
      existing.total += 1;
      if (seat.available) existing.available += 1;
    }
  }

  summary.byType = [...types.values()].sort((a, b) => {
    const byType = a.seatType.localeCompare(b.seatType);
    if (byType !== 0) return byType;
    const bySurcharge = (a.surchargeYen ?? -1) - (b.surchargeYen ?? -1);
    if (bySurcharge !== 0) return bySurcharge;
    return (a.priceCategory ?? "").localeCompare(b.priceCategory ?? "");
  });
  return summary;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isAllowed(
  seat: Seat,
  allowed: readonly string[],
  excluded: readonly string[],
  maxSurcharge: number,
): { ok: boolean; reason?: string } {
  if (seat.wheelchair) return { ok: false, reason: "wheelchair" };
  if (!seat.selectable || !seat.available) return { ok: false, reason: "unavailable" };
  if (excluded.includes(seat.seatType))
    return { ok: false, reason: `excluded type ${seat.seatType}` };
  if (!allowed.includes(seat.seatType))
    return { ok: false, reason: `type ${seat.seatType} not allowed` };
  if (seat.surchargeYen === undefined) return { ok: false, reason: "unknown surcharge" };
  if (seat.surchargeYen > maxSurcharge) {
    return { ok: false, reason: `surcharge ${seat.surchargeYen} > ${maxSurcharge}` };
  }
  return { ok: true };
}

function sameAttributes(a: Seat, b: Seat): boolean {
  return (
    a.seatType === b.seatType &&
    a.priceCategory === b.priceCategory &&
    (a.surchargeYen ?? 0) === (b.surchargeYen ?? 0)
  );
}

type RowInfo = {
  row: string;
  seats: Seat[];
  minX: number;
  maxX: number;
  centerX: number;
  y: number;
};

function buildRowInfos(seats: readonly Seat[]): RowInfo[] {
  const rows = new Map<string, Seat[]>();
  for (const seat of seats) {
    const list = rows.get(seat.row);
    if (list === undefined) rows.set(seat.row, [seat]);
    else list.push(seat);
  }

  const infos: RowInfo[] = [];
  for (const [row, rowSeats] of rows) {
    const xs = rowSeats
      .map((seat, index) => seat.x ?? seat.number * 40 + index * 0)
      .filter((value) => Number.isFinite(value));
    const ys = rowSeats
      .map((seat, index) => seat.y ?? index)
      .filter((value) => Number.isFinite(value));
    const minX = xs.length > 0 ? Math.min(...xs) : 0;
    const maxX = xs.length > 0 ? Math.max(...xs) : 0;
    infos.push({
      row,
      seats: rowSeats,
      minX,
      maxX,
      centerX: (minX + maxX) / 2,
      y: average(ys),
    });
  }

  infos.sort((a, b) => a.y - b.y);
  return infos;
}

function isAisleSeat(seat: Seat, rowSeats: readonly Seat[]): boolean {
  const sorted = [...rowSeats].sort((a, b) => a.number - b.number);
  const index = sorted.findIndex(
    (candidate) => candidate.number === seat.number && candidate.row === seat.row,
  );
  if (index <= 0 || index >= sorted.length - 1) return true;

  const previous = sorted[index - 1];
  const next = sorted[index + 1];
  const spacing = Math.abs(
    (seat.x ?? seat.number * 40) - (previous?.x ?? (previous?.number ?? 0) * 40),
  );
  const averageSpacing =
    sorted.length > 1
      ? Math.abs((sorted[sorted.length - 1]?.x ?? 0) - (sorted[0]?.x ?? 0)) / (sorted.length - 1)
      : spacing || 40;
  const leftGap =
    previous === undefined
      ? 0
      : Math.abs((seat.x ?? seat.number * 40) - (previous.x ?? previous.number * 40));
  const rightGap =
    next === undefined ? 0 : Math.abs((next.x ?? next.number * 40) - (seat.x ?? seat.number * 40));
  return leftGap > averageSpacing * 1.6 || rightGap > averageSpacing * 1.6;
}

function consecutiveWindows<T>(items: readonly T[], size: number): T[][] {
  const windows: T[][] = [];
  for (let start = 0; start + size <= items.length; start += 1) {
    windows.push(items.slice(start, start + size));
  }
  return windows;
}

export function rankSeatGroups(
  seats: readonly Seat[],
  options: SeatRankingOptions,
): (SeatGroup & { targetRow: string })[] {
  const allowed = options.allowedSeatTypes ?? DEFAULT_ALLOWED_SEAT_TYPES;
  const excludedTypes = options.excludedSeatTypes ?? [];
  const maxSurcharge = options.maxSurchargeYen ?? DEFAULT_MAX_SURCHARGE_YEN;
  const aislePreference = options.aislePreference ?? "none";
  const targetRatio = options.targetRowRatio ?? DEFAULT_TARGET_ROW_RATIO;
  const minScore = options.minScore ?? 0;
  const excludedRows = options.excludedRows ?? [];
  const preferredRows = options.preferredRows ?? [];
  const preferredSeatNumbers = options.preferredSeatNumbers ?? [];

  const rowInfos = buildRowInfos(seats);
  if (rowInfos.length === 0) return [];

  const minY = rowInfos[0]?.y ?? 0;
  const maxY = rowInfos[rowInfos.length - 1]?.y ?? 0;
  const yRange = maxY - minY || 1;
  const targetY =
    options.screenSide === "top" ? minY + targetRatio * yRange : maxY - targetRatio * yRange;

  let targetRow = rowInfos[0]?.row ?? "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const info of rowInfos) {
    const distance = Math.abs(info.y - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      targetRow = info.row;
    }
  }

  const groups: (SeatGroup & { targetRow: string })[] = [];

  for (const info of rowInfos) {
    if (excludedRows.includes(info.row)) continue;

    const candidates = info.seats
      .filter((seat) => isAllowed(seat, allowed, excludedTypes, maxSurcharge).ok)
      .sort((a, b) => a.number - b.number);
    if (candidates.length < options.ticketCount) continue;

    const windows = consecutiveWindows(candidates, options.ticketCount);
    for (const window of windows) {
      const sorted = [...window].sort((a, b) => a.number - b.number);
      const first = sorted[0];
      if (first === undefined) continue;

      if (options.requireAdjacent) {
        const consecutive = sorted.every((seat, index) =>
          index === 0 ? true : seat.number === (sorted[index - 1]?.number ?? -999) + 1,
        );
        if (!consecutive) continue;
      }

      if (!sorted.every((seat) => sameAttributes(seat, first))) continue;

      const groupX = average(sorted.map((seat) => seat.x ?? seat.number * 40));
      const halfWidth = (info.maxX - info.minX) / 2 || 1;
      const horizontalDeviation = Math.min(1, Math.abs(groupX - info.centerX) / halfWidth);
      const rowDeviation = Math.min(1, Math.abs(info.y - targetY) / yRange);

      const reasons: string[] = [];
      let score = 100 - horizontalDeviation * 45 - rowDeviation * 35;

      if (preferredRows.includes(info.row)) {
        score += 15;
        reasons.push("preferred row");
      }

      if (
        preferredSeatNumbers.length > 0 &&
        sorted.every((seat) => preferredSeatNumbers.includes(seat.number))
      ) {
        score += 10;
        reasons.push("preferred seat numbers");
      }

      const hasAisle = sorted.some((seat) => isAisleSeat(seat, info.seats));
      if (aislePreference === "prefer" && hasAisle) {
        score += 5;
        reasons.push("aisle");
      } else if (aislePreference === "avoid" && hasAisle) {
        score -= 5;
        reasons.push("aisle avoided");
      }

      if (score < minScore) continue;

      reasons.unshift(
        `${info.row}${first.number}${
          sorted.length > 1 ? `-${sorted[sorted.length - 1]?.number}` : ""
        } ${first.seatType}${first.surchargeYen !== undefined ? ` (+${first.surchargeYen})` : ""}`,
      );

      groups.push({
        seats: sorted,
        score: Math.round(score * 100) / 100,
        reasons,
        targetRow,
      });
    }
  }

  groups.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.seats[0]?.number ?? 0) - (b.seats[0]?.number ?? 0);
  });
  return groups;
}
