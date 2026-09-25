export type Seat = {
  section: string;
  row: string;
  number: number;
  label: string;
  available: boolean;
  selectable: boolean;
  wheelchair: boolean;
  seatType: string;
  priceCategory?: string;
  surchargeYen?: number;
  rawPriceText?: string;
  x?: number;
  y?: number;
};

export type SeatGroup = {
  seats: Seat[];
  score: number;
  reasons: string[];
};

export const SEAT_TYPE_BY_CLASS: Record<string, string> = {
  "seat-ottoman": "ottoman",
  "seat-comfort": "comfort",
  "seat-grand-class": "grandClass",
  "seat-premium-class": "premiumClass",
  "seat-parent-and-child-pair-left": "parentAndChildPairLeft",
  "seat-parent-and-child-pair-right": "parentAndChildPairRight",
};

const ROW_CLASS_PATTERN = /^seat-[A-Za-z]{1,2}$/;
const ROW_NUMBER_CLASS_PATTERN = /^seat-[A-Za-z]{1,2}\d+$/;

export function normalizeSeatLabel(label: string): string {
  return label
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function parseSeatLabel(label: string): { row: string; number: number } | undefined {
  const normalized = normalizeSeatLabel(label).replace(/[^A-Z0-9]/g, "");
  const match = /^([A-Z]+)(\d+)$/.exec(normalized);
  if (match === null) return undefined;
  return { row: match[1] ?? "", number: Number(match[2]) };
}

export function seatClassTokens(className: string): string[] {
  return className.split(/\s+/).filter((token) => token !== "");
}

export function classifySeatClasses(className: string): {
  seatType: string;
  wheelchair: boolean;
} {
  const tokens = seatClassTokens(className);
  const wheelchair = tokens.includes("seat-hc");

  const specialTokens = tokens.filter(
    (token) =>
      token.startsWith("seat-") &&
      token !== "seat" &&
      token !== "seat-hc" &&
      !ROW_CLASS_PATTERN.test(token) &&
      !ROW_NUMBER_CLASS_PATTERN.test(token),
  );

  if (specialTokens.length === 0) {
    return { seatType: "standard", wheelchair };
  }

  for (const token of specialTokens) {
    const mapped = SEAT_TYPE_BY_CLASS[token];
    if (mapped !== undefined) {
      return { seatType: mapped, wheelchair };
    }
  }

  return { seatType: "unknown", wheelchair };
}

export function seatKey(row: string, number: number): string {
  return `${row}${number}`;
}
