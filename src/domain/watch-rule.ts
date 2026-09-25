import { z } from "zod";

export const THEATER_CODE = "020" as const;

export type MemberTier = "platinum" | "bronze" | "gold" | "none";
export type WatchMode = "notify" | "assist" | "hold";
export type AislePreference = "none" | "prefer" | "avoid";

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isParseableDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export const watchRuleInputSchema = z
  .object({
    theaterCode: z.literal(THEATER_CODE).default(THEATER_CODE),
    movieTitlePattern: z
      .string()
      .min(1)
      .refine(isValidRegExp, { message: "movieTitlePattern must be a valid regular expression" }),
    targetDate: z.string().refine(isRealCalendarDate, {
      message: "targetDate must be a real calendar date (YYYY-MM-DD)",
    }),
    formatIncludes: z.array(z.string().min(1)).default([]),
    formatExcludes: z.array(z.string().min(1)).default([]),
    startTimeFrom: z.string().regex(HHMM_PATTERN, "startTimeFrom must be HH:mm").optional(),
    startTimeTo: z.string().regex(HHMM_PATTERN, "startTimeTo must be HH:mm").optional(),
    ticketCount: z.number().int().min(1).max(6).default(1),
    requireAdjacent: z.boolean().default(true),
    preferredRows: z.array(z.string().min(1)).optional(),
    excludedRows: z.array(z.string().min(1)).optional(),
    preferredSeatNumbers: z.array(z.number().int().positive()).optional(),
    aislePreference: z.enum(["none", "prefer", "avoid"]).default("none"),
    mode: z.enum(["notify", "assist", "hold"]).default("notify"),
    memberTier: z.enum(["platinum", "bronze", "gold", "none"]).default("none"),
    saleOpensAtOverride: z
      .string()
      .min(1)
      .refine(isParseableDateTime, { message: "saleOpensAtOverride must be a parseable date-time" })
      .optional(),
  })
  .refine(
    (value) =>
      value.startTimeFrom === undefined ||
      value.startTimeTo === undefined ||
      value.startTimeFrom <= value.startTimeTo,
    { message: "startTimeFrom must not be later than startTimeTo", path: ["startTimeFrom"] },
  );

export type WatchRuleInput = z.infer<typeof watchRuleInputSchema>;

export type WatchRule = WatchRuleInput & {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export function parseWatchRuleInput(input: unknown): WatchRuleInput {
  return watchRuleInputSchema.parse(input);
}
