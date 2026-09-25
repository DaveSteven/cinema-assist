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
  unmappableFree?: number;
  duplicateFreeKeys?: number;
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
      if (key === undefined) {
        info.unmappableFree = (info.unmappableFree ?? 0) + 1;
        continue;
      }
      if (info.availableKeys.has(key)) {
        info.duplicateFreeKeys = (info.duplicateFreeKeys ?? 0) + 1;
        continue;
      }
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
  const actual = seats.filter((seat) => seat.available).length;
  const expected = expectedAvailableCount(info);
  if (actual !== expected) {
    throw new SeatStateCountMismatchError(expected, actual);
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
        resolveOutcome(
          info.ok && isSeatStateConsistent(info) ? { status: "ok", info } : { status: "invalid" },
        );
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
  screenCenterX?: number;
  screenWidth?: number;
  url?: string;
  seatElementCount: number;
  parsedDomSeatCount: number;
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
    const screenRect = screenEl?.getBoundingClientRect();
    const screenY = screenRect?.top;
    const screenCenterX =
      screenRect !== undefined && screenRect.width > 0
        ? screenRect.left + screenRect.width / 2
        : undefined;
    const screenWidth =
      screenRect !== undefined && screenRect.width > 0 ? screenRect.width : undefined;

    return { seats, legend, screenY, screenCenterX, screenWidth, elementCount: elements.length };
  }, selectors)) as {
    seats: DomSeat[];
    legend: { className: string; text: string }[];
    screenY?: number;
    screenCenterX?: number;
    screenWidth?: number;
    elementCount: number;
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
    seatElementCount: dom.elementCount,
    parsedDomSeatCount: dom.seats.length,
    ...(dom.screenY !== undefined ? { screenY: dom.screenY } : {}),
    ...(dom.screenCenterX !== undefined ? { screenCenterX: dom.screenCenterX } : {}),
    ...(dom.screenWidth !== undefined ? { screenWidth: dom.screenWidth } : {}),
    url: page.url(),
  };
}

export type SeatMapWaitOptions = {
  timeoutMs?: number;
  pollMs?: number;
  read?: (page: Page) => Promise<SeatMapResult>;
};

export type SeatMapTimeoutDiagnostics = {
  url?: string;
  domSeatElementCount?: number;
  parsedDomSeatCount?: number;
  availableCount?: number;
  apiFreeCount?: number;
  mappedApiFree?: number;
  unmappableFree?: number;
  duplicateFreeKeys?: number;
  expectedAvailableCount?: number;
};

export type SeatMapWaitResult =
  | ({ status: "ready" } & SeatMapResult)
  | ({ status: "timeout" } & SeatMapTimeoutDiagnostics);

export function isSeatStateConsistent(info: SeatStateInfo): boolean {
  if (!info.ok) return false;
  if ((info.duplicateFreeKeys ?? 0) > 0) return false;
  if (info.countFree === undefined) return true;
  const mapped = info.availableKeys.size;
  const extra = info.unmappableFree ?? 0;
  return mapped <= info.countFree && info.countFree <= mapped + extra;
}

function expectedAvailableCount(info: SeatStateInfo): number {
  return info.availableKeys.size;
}

function seatCountMatches(info: SeatStateInfo, seats: readonly Seat[]): boolean {
  return seats.filter((seat) => seat.available).length === expectedAvailableCount(info);
}

export async function waitForSeatMap(
  page: Page,
  seatState: SeatStateInfo,
  options: SeatMapWaitOptions = {},
): Promise<SeatMapWaitResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 500;
  const read = options.read ?? ((target: Page) => readSeatMap(target, seatState));
  const deadline = Date.now() + timeoutMs;
  let last: SeatMapResult | undefined;

  for (;;) {
    last = await read(page);
    if (last.seats.length > 0 && seatCountMatches(seatState, last.seats)) {
      return { status: "ready", ...last };
    }
    if (Date.now() >= deadline) {
      return {
        status: "timeout",
        ...(last.url !== undefined ? { url: last.url } : {}),
        domSeatElementCount: last.seatElementCount,
        parsedDomSeatCount: last.parsedDomSeatCount,
        availableCount: last.seats.filter((seat) => seat.available).length,
        ...(seatState.countFree !== undefined ? { apiFreeCount: seatState.countFree } : {}),
        mappedApiFree: seatState.availableKeys.size,
        ...(seatState.unmappableFree !== undefined
          ? { unmappableFree: seatState.unmappableFree }
          : {}),
        ...(seatState.duplicateFreeKeys !== undefined
          ? { duplicateFreeKeys: seatState.duplicateFreeKeys }
          : {}),
        expectedAvailableCount: expectedAvailableCount(seatState),
      };
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
}

export type WaitForSeatPageOptions = {
  timeoutMs?: number;
  pollMs?: number;
};

export async function waitForSeatPage(
  page: Page,
  options: WaitForSeatPageOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const url = page.url();
    const onSeatRoute = /#\/purchase\/seat|\/purchase\/seat/.test(url);
    let count = 0;
    try {
      count = await page.locator(SELECTORS.seat.seat).count();
    } catch {
      count = 0;
    }
    if (onSeatRoute && count > 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
}

export type HighlightOptions = {
  label?: string;
};

export function normalizeSeatToken(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export function labelsMatch(recommended: readonly string[], matched: readonly string[]): boolean {
  if (recommended.length !== matched.length) return false;
  const left = [...recommended].sort();
  const right = [...matched].sort();
  return left.every((value, index) => value === right[index]);
}

export async function highlightSeats(
  page: Page,
  seats: readonly Seat[],
  options: HighlightOptions = {},
): Promise<string[]> {
  const labels = seats.map((seat) => normalizeSeatToken(`${seat.row}${seat.number}`));
  const text =
    options.label ??
    `cinema-assist 推荐座位: ${seats.map((seat) => `${seat.row}${seat.number}`).join(", ")}`;

  return await page.evaluate(
    (payload) => {
      for (const existing of Array.from(document.querySelectorAll("[data-cinema-assist]"))) {
        if (existing.getAttribute("data-cinema-assist") === "banner") {
          existing.remove();
          continue;
        }
        const element = existing as HTMLElement;
        element.style.outline = "";
        element.style.outlineOffset = "";
        element.removeAttribute("data-cinema-assist");
      }

      const matched: string[] = [];
      const elements = Array.from(document.querySelectorAll(payload.selector));
      for (const element of elements) {
        const normalized = (element.textContent || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        if (!payload.labels.includes(normalized)) continue;
        const target = element as HTMLElement;
        target.style.outline = "3px solid #ff2d55";
        target.style.outlineOffset = "1px";
        target.setAttribute("data-cinema-assist", "recommended");
        matched.push(normalized);
      }

      const banner = document.createElement("div");
      banner.textContent = payload.text;
      banner.setAttribute("data-cinema-assist", "banner");
      banner.style.cssText =
        "position:fixed;z-index:99999;left:12px;bottom:12px;background:#ff2d55;color:#fff;padding:8px 12px;border-radius:6px;font-weight:bold;font-size:13px;";
      document.body.appendChild(banner);

      return matched;
    },
    { selector: SELECTORS.seat.seat, labels, text },
  );
}
