const JST_OFFSET = "+09:00";

const JST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function toJstIsoString(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${instant}`);
  }
  const parts = JST_FORMATTER.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const rawHour = lookup("hour");
  const hour = rawHour === "24" ? "00" : rawHour;
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${hour}:${lookup("minute")}:${lookup("second")}${JST_OFFSET}`;
}

export function toOptionalJstIsoString(instant: string | undefined): string | undefined {
  return instant === undefined ? undefined : toJstIsoString(instant);
}

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new Error(`Invalid date value: ${date}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function shiftIsoDate(date: string, days: number): string {
  const { year, month, day } = parseDateParts(date);
  const shifted = Date.UTC(year, month - 1, day) + days * 86_400_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function jstDateTimeIso(date: string, hour: number, minute: number): string {
  parseDateParts(date);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date}T${pad(hour)}:${pad(minute)}:00${JST_OFFSET}`;
}

export const JST_TIMEZONE = "Asia/Tokyo";
