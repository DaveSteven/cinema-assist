import type {
  SalesAudience,
  SalesStatus,
  SalesWindow,
  SalesWindows,
  Screening,
} from "../../domain/screening.js";
import { toJstIsoString, toOptionalJstIsoString } from "../../domain/time.js";
import type { DaySchedule, LocalizedName, ScheduleIndex } from "./schedule-schema.js";

export { toJstIsoString };

export const PURCHASE_BASE_URL =
  "https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction";

export function pickLocalizedName(name: LocalizedName | undefined): string {
  if (name === undefined) return "";
  return name.ja?.trim() || name.en?.trim() || "";
}

export function extractFormatLabels(movieTitle: string, screenName: string): string[] {
  const labels = new Set<string>();

  for (const match of movieTitle.matchAll(/【([^】]+)】/g)) {
    const value = match[1]?.trim();
    if (value) labels.add(value);
  }

  for (const segment of movieTitle.split("/").slice(1)) {
    const value = segment.trim();
    if (value) labels.add(value);
  }

  for (const match of screenName.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    labels.add(match[0]);
  }

  return [...labels];
}

const FEW_ABSOLUTE = 5;
const FEW_RATIO = 0.05;

export type SalesStatusInput = {
  now: Date;
  window?: SalesWindow | undefined;
  remaining?: number | undefined;
  capacity?: number | undefined;
};

export function classifySalesStatus(input: SalesStatusInput): SalesStatus {
  const now = input.now.getTime();
  const startsAt = input.window?.startsAt;
  const endsAt = input.window?.endsAt;

  if (endsAt !== undefined && now >= Date.parse(endsAt)) {
    return "ended";
  }
  if (startsAt === undefined || now < Date.parse(startsAt)) {
    return "not_open";
  }
  if (input.remaining !== undefined) {
    if (input.remaining <= 0) {
      return "sold_out";
    }
    const capacity = input.capacity ?? input.remaining;
    const threshold = Math.max(FEW_ABSOLUTE, Math.ceil(capacity * FEW_RATIO));
    if (input.remaining <= threshold) {
      return "few";
    }
  }
  return "open";
}

export function buildSalesWindows(offers: {
  validFrom?: string | undefined;
  validThrough?: string | undefined;
  validFromForMembers?: string | undefined;
  validThroughForMembers?: string | undefined;
}): SalesWindows {
  const publicWindow: SalesWindow = {
    startsAt: toOptionalJstIsoString(offers.validFrom),
    endsAt: toOptionalJstIsoString(offers.validThrough),
  };
  const hasMemberWindow =
    offers.validFromForMembers !== undefined || offers.validThroughForMembers !== undefined;
  const memberWindow: SalesWindow | undefined = hasMemberWindow
    ? {
        startsAt: toOptionalJstIsoString(offers.validFromForMembers),
        endsAt: toOptionalJstIsoString(offers.validThroughForMembers),
      }
    : undefined;
  return {
    public: publicWindow,
    ...(memberWindow !== undefined ? { member: memberWindow } : {}),
  };
}

export type NormalizeDayOptions = {
  movieCode: string;
  theaterCode: string;
  now?: Date;
  audience?: SalesAudience;
};

export function selectSalesWindow(windows: SalesWindows, audience: SalesAudience): SalesWindow {
  if (audience === "member") {
    return windows.member ?? windows.public;
  }
  return windows.public;
}

export function listMovieCodesForTheaterDate(
  index: ScheduleIndex,
  theaterCode: string,
  date: string,
): string[] {
  const movieCodes: string[] = [];
  for (const [movieCode, theaters] of Object.entries(index)) {
    if (theaters[theaterCode]?.[date] !== undefined) {
      movieCodes.push(movieCode);
    }
  }
  return movieCodes;
}

export function normalizeDaySchedule(day: DaySchedule, options: NormalizeDayOptions): Screening[] {
  const now = options.now ?? new Date();
  const audience = options.audience ?? "public";
  const screenings: Screening[] = [];

  for (const rooms of Object.values(day)) {
    for (const [roomCode, entry] of Object.entries(rooms)) {
      const movieTitle = pickLocalizedName(entry.name);
      const screenName = pickLocalizedName(entry.location.name);
      const endsAt = entry.endDate !== undefined ? toJstIsoString(entry.endDate) : undefined;
      const salesWindows = buildSalesWindows(entry.offers ?? {});
      const salesWindow = selectSalesWindow(salesWindows, audience);

      screenings.push({
        performanceId: entry.id,
        movieCode: entry.smartTheaterNo ?? options.movieCode,
        movieTitle,
        theaterCode: options.theaterCode,
        screenName: screenName || roomCode,
        formatLabels: extractFormatLabels(movieTitle, screenName),
        startsAt: toJstIsoString(entry.startDate),
        ...(endsAt !== undefined ? { endsAt } : {}),
        salesStatus: classifySalesStatus({
          now,
          window: salesWindow,
          remaining: entry.remainingAttendeeCapacity,
          capacity: entry.maximumAttendeeCapacity,
        }),
        salesWindows,
        purchaseUrl: `${PURCHASE_BASE_URL}/${entry.id}`,
      });
    }
  }

  return screenings.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
