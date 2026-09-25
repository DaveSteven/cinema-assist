import type { Page } from "playwright";
import { z } from "zod";
import {
  classifySeatClasses,
  parseSeatLabel,
  type Seat,
  seatClassTokens,
  seatKey,
} from "../../domain/seat.js";
import { SEAT_STATE_URL_FRAGMENT, SELECTORS, THEATER_LAYOUT_URL_FRAGMENT } from "./selectors.js";

const freeSeatSchema = z.looseObject({
  seatNum: z.string(),
  spseatKbn: z.string().optional(),
  spseatAdd1: z.number().optional(),
  spseatAdd2: z.number().optional(),
});

const seatStateSchema = z.looseObject({
  cntReserveFree: z.number().optional(),
  cntSeatLine: z.number().optional(),
  listSeat: z
    .array(
      z.looseObject({
        seatSection: z.string().optional(),
        listFreeSeat: z.array(freeSeatSchema).optional(),
      }),
    )
    .optional(),
});

export type FreeSeatInfo = {
  seatNum: string;
  spseatKbn?: string;
  spseatAdd1?: number;
  spseatAdd2?: number;
};

export type SeatStateInfo = {
  ok: boolean;
  countFree?: number;
  availableKeys: Set<string>;
  byKey: Map<string, FreeSeatInfo>;
};

function normalizeKey(label: string): string | undefined {
  const parsed = parseSeatLabel(label);
  if (parsed === undefined) return undefined;
  return seatKey(parsed.row, parsed.number);
}

export function parseSeatState(raw: unknown): SeatStateInfo {
  const info: SeatStateInfo = { ok: false, availableKeys: new Set(), byKey: new Map() };
  const parsed = seatStateSchema.safeParse(raw);
  if (!parsed.success) return info;

  const hasData = parsed.data.cntReserveFree !== undefined || parsed.data.listSeat !== undefined;
  if (!hasData) return info;
  info.ok = true;

  if (parsed.data.cntReserveFree !== undefined) {
    info.countFree = parsed.data.cntReserveFree;
  }

  for (const section of parsed.data.listSeat ?? []) {
    for (const freeSeat of section.listFreeSeat ?? []) {
      const key = normalizeKey(freeSeat.seatNum);
      if (key === undefined) continue;
      info.availableKeys.add(key);
      info.byKey.set(key, freeSeat);
    }
  }
  return info;
}

export class SeatStateUnavailableError extends Error {
  readonly reason: "timeout" | "invalid";

  constructor(reason: "timeout" | "invalid") {
    super(
      reason === "timeout"
        ? "座位状态接口超时，无法确认可售座位（不视为售罄）"
        : "座位状态接口返回无效数据，无法确认可售座位（不视为售罄）",
    );
    this.name = "SeatStateUnavailableError";
    this.reason = reason;
  }
}

export class SeatStateCountMismatchError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`座位状态计数不一致：接口 ${expected}，解析 ${actual}`);
    this.name = "SeatStateCountMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export type SeatStateOutcome =
  | { status: "ok"; info: SeatStateInfo }
  | { status: "timeout" }
  | { status: "invalid" };

export function requireSeatState(outcome: SeatStateOutcome): SeatStateInfo {
  if (outcome.status !== "ok") {
    throw new SeatStateUnavailableError(outcome.status);
  }
  return outcome.info;
}

export function assertSeatStateCount(info: SeatStateInfo, seats: readonly Seat[]): void {
  if (info.countFree === undefined) return;
  const actual = seats.filter((seat) => seat.available).length;
  if (actual !== info.countFree) {
    throw new SeatStateCountMismatchError(info.countFree, actual);
  }
}

export type SeatLegendEntry = {
  className: string;
  seatType: string;
  priceCategory?: string;
  surchargeYen?: number;
  rawPriceText: string;
};

function parseSurcharge(text: string): number | undefined {
  const match = /[+＋]\s*[￥¥]\s*([\d,]+)/.exec(text);
  if (match?.[1] === undefined) return undefined;
  return Number(match[1].replace(/,/g, ""));
}

function parsePriceCategory(text: string): string {
  return text
    .replace(/[+＋]\s*[￥¥]\s*[\d,]+/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSeatLegend(
  items: readonly { className: string; text: string }[],
): SeatLegendEntry[] {
  return items.map((item) => {
    const surchargeYen = parseSurcharge(item.text);
    const priceCategory = parsePriceCategory(item.text);
    return {
      className: item.className,
      seatType: classifySeatClasses(item.className).seatType,
      ...(priceCategory !== "" ? { priceCategory } : {}),
      ...(surchargeYen !== undefined ? { surchargeYen } : {}),
      rawPriceText: item.text,
    };
  });
}

export type DomSeat = {
  label: string;
  className: string;
  x?: number;
  y?: number;
};

function legendForClass(
  className: string,
  legend: readonly SeatLegendEntry[],
): SeatLegendEntry | undefined {
  const tokens = seatClassTokens(className);
  return legend.find((entry) =>
    tokens.some(
      (token) => token === entry.className || entry.className.split(/\s+/).includes(token),
    ),
  );
}

export function mergeSeatMap(
  domSeats: readonly DomSeat[],
  legend: readonly SeatLegendEntry[],
  seatState: SeatStateInfo,
): Seat[] {
  const seats: Seat[] = [];
  for (const domSeat of domSeats) {
    const parsed = parseSeatLabel(domSeat.label);
    if (parsed === undefined) continue;

    const { seatType, wheelchair } = classifySeatClasses(domSeat.className);
    const key = seatKey(parsed.row, parsed.number);
    const available = seatState.availableKeys.has(key);
    const entry = legendForClass(domSeat.className, legend);
    const surchargeYen = entry?.surchargeYen ?? (seatType === "standard" ? 0 : undefined);

    seats.push({
      section: "",
      row: parsed.row,
      number: parsed.number,
      label: domSeat.label,
      available,
      selectable: available && !wheelchair,
      wheelchair,
      seatType,
      ...(entry?.priceCategory !== undefined ? { priceCategory: entry.priceCategory } : {}),
      ...(surchargeYen !== undefined ? { surchargeYen } : {}),
      ...(entry?.rawPriceText !== undefined ? { rawPriceText: entry.rawPriceText } : {}),
      ...(domSeat.x !== undefined ? { x: domSeat.x } : {}),
      ...(domSeat.y !== undefined ? { y: domSeat.y } : {}),
    });
  }
  return seats;
}

export type SeatStateCapture = {
  waitForSeatState(timeoutMs?: number): Promise<SeatStateOutcome>;
};

export function captureSeatState(page: Page): SeatStateCapture {
  let settled = false;
  let resolveOutcome: (outcome: SeatStateOutcome) => void = () => {};
  const promise = new Promise<SeatStateOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  page.on("response", (response) => {
    if (settled || !response.url().includes(SEAT_STATE_URL_FRAGMENT)) return;
    settled = true;
    response
      .json()
      .then((json: unknown) => {
        const info = parseSeatState(json);
        resolveOutcome(info.ok ? { status: "ok", info } : { status: "invalid" });
      })
      .catch(() => {
        resolveOutcome({ status: "invalid" });
      });
  });

  return {
    waitForSeatState(timeoutMs = 20_000): Promise<SeatStateOutcome> {
      return Promise.race([
        promise,
        new Promise<SeatStateOutcome>((resolve) => {
          setTimeout(() => {
            resolve({ status: "timeout" });
          }, timeoutMs);
        }),
      ]);
    },
  };
}

export type ScreenSide = "top" | "bottom" | "unknown";

export function determineScreenSide(
  screenY: number | undefined,
  seatYs: readonly number[],
): ScreenSide {
  if (screenY === undefined || seatYs.length === 0) return "unknown";
  const minY = Math.min(...seatYs);
  const maxY = Math.max(...seatYs);
  if (screenY < minY) return "top";
  if (screenY > maxY) return "bottom";
  return "unknown";
}

const theaterLayoutSchema = z.looseObject({
  objects: z
    .array(
      z.looseObject({
        image: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
    )
    .optional(),
  seatStart: z.looseObject({ x: z.number().optional(), y: z.number().optional() }).optional(),
});

export type TheaterLayout = {
  screenSide: ScreenSide;
  screenY?: number;
  seatStartY?: number;
};

export function parseTheaterLayout(raw: unknown): TheaterLayout {
  const parsed = theaterLayoutSchema.safeParse(raw);
  if (!parsed.success) return { screenSide: "unknown" };

  const screenObject = (parsed.data.objects ?? []).find((object) =>
    (object.image ?? "").includes("/screen/"),
  );
  const screenY = screenObject?.y;
  const seatStartY = parsed.data.seatStart?.y;

  if (screenY === undefined || seatStartY === undefined) {
    return { screenSide: "unknown", ...(screenY !== undefined ? { screenY } : {}) };
  }

  const screenSide: ScreenSide =
    screenY < seatStartY ? "top" : screenY > seatStartY ? "bottom" : "unknown";
  return {
    screenSide,
    screenY,
    seatStartY,
  };
}

export type TheaterLayoutCapture = {
  waitForScreenSide(timeoutMs?: number): Promise<TheaterLayout>;
};

export function captureTheaterLayout(page: Page): TheaterLayoutCapture {
  let settled = false;
  let resolveLayout: (layout: TheaterLayout) => void = () => {};
  const promise = new Promise<TheaterLayout>((resolve) => {
    resolveLayout = resolve;
  });

  page.on("response", (response) => {
    if (settled || !response.url().includes(THEATER_LAYOUT_URL_FRAGMENT)) return;
    response
      .json()
      .then((json: unknown) => {
        const layout = parseTheaterLayout(json);
        if (layout.screenSide === "unknown") return;
        settled = true;
        resolveLayout(layout);
      })
      .catch(() => {});
  });

  return {
    waitForScreenSide(timeoutMs = 5_000): Promise<TheaterLayout> {
      return Promise.race([
        promise,
        new Promise<TheaterLayout>((resolve) => {
          setTimeout(() => {
            resolve({ screenSide: "unknown" });
          }, timeoutMs);
        }),
      ]);
    },
  };
}

export type SeatMapResult = {
  seats: Seat[];
  legend: SeatLegendEntry[];
  screenSide: ScreenSide;
  screenY?: number;
};

export async function readSeatMap(page: Page, seatState: SeatStateInfo): Promise<SeatMapResult> {
  const selectors = {
    seat: SELECTORS.seat.seat,
    seatTypesItem: SELECTORS.seat.seatTypesItem,
    screen: SELECTORS.seat.screen,
  };

  const dom = (await page.evaluate((sel) => {
    const seats: { label: string; className: string; x?: number; y?: number }[] = [];
    const elements = Array.from(document.querySelectorAll(sel.seat));
    for (const el of elements) {
      const label = (el.textContent || "").trim();
      if (!/^[A-Za-z]+\d+$/.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      seats.push({
        label,
        className: el.getAttribute("class") || "",
        x: rect.left,
        y: rect.top,
      });
    }

    const legend = Array.from(document.querySelectorAll(sel.seatTypesItem)).map((el) => ({
      className: el.getAttribute("class") || "",
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
    }));

    const screenEl = document.querySelector(sel.screen);
    const screenY = screenEl === null ? undefined : screenEl.getBoundingClientRect().top;

    return { seats, legend, screenY };
  }, selectors)) as {
    seats: DomSeat[];
    legend: { className: string; text: string }[];
    screenY?: number;
  };

  const legend = parseSeatLegend(dom.legend);
  const seats = mergeSeatMap(dom.seats, legend, seatState);
  const screenSide = determineScreenSide(
    dom.screenY,
    seats.map((seat) => seat.y ?? Number.NaN).filter((value) => Number.isFinite(value)),
  );

  return {
    seats,
    legend,
    screenSide,
    ...(dom.screenY !== undefined ? { screenY: dom.screenY } : {}),
  };
}
