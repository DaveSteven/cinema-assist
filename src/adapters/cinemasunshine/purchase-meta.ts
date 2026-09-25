import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";

export type PurchaseMetaRaw = {
  theaterScreen: string;
  dateTime: string;
  title: string;
};

export type PurchaseMeta = {
  performanceIdFromUrl?: string;
  theaterName: string;
  screenName: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  raw: PurchaseMetaRaw;
};

export function parseDateText(text: string): {
  date?: string;
  startTime?: string;
  endTime?: string;
} {
  const match =
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^0-9]*(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/.exec(
      text,
    );
  if (match === null) return {};
  const pad = (value: string): string => value.padStart(2, "0");
  const date = `${match[1]}-${pad(match[2] ?? "")}-${pad(match[3] ?? "")}`;
  const startTime = `${pad(match[4] ?? "")}:${match[5] ?? ""}`;
  const endTime = match[6] !== undefined ? `${pad(match[6])}:${match[7] ?? ""}` : undefined;
  return {
    date,
    startTime,
    ...(endTime !== undefined ? { endTime } : {}),
  };
}

export function parsePurchaseMeta(raw: PurchaseMetaRaw): PurchaseMeta {
  const [theaterName = "", ...screenParts] = raw.theaterScreen
    .split("/")
    .map((part) => part.trim());
  const screenName = screenParts.join("/");
  const dateTime = parseDateText(raw.dateTime);
  return {
    theaterName,
    screenName,
    title: raw.title.trim(),
    raw,
    ...dateTime,
  };
}

export async function readPurchaseMeta(
  page: Page,
  options: { performanceId?: string } = {},
): Promise<PurchaseMeta | undefined> {
  const raw = (await page
    .evaluate(
      (selectors) => {
        const lists = Array.from(document.querySelectorAll(selectors.metaList));
        for (const list of lists) {
          if (!(list.textContent || "").includes("作品名")) continue;
          const terms = Array.from(list.querySelectorAll("dt"));
          const details = Array.from(list.querySelectorAll("dd"));
          let theaterScreen = "";
          let dateTime = "";
          let title = "";
          for (let index = 0; index < terms.length && index < details.length; index += 1) {
            const label = (terms[index]?.textContent || "").replace(/\s+/g, " ").trim();
            const value = (details[index]?.textContent || "").replace(/\s+/g, " ").trim();
            if (label.includes("劇場") && label.includes("スクリーン")) theaterScreen = value;
            else if (label.includes("鑑賞日時")) dateTime = value;
            else if (label.includes("作品名")) title = value;
          }
          if (theaterScreen !== "" || dateTime !== "" || title !== "") {
            return { theaterScreen, dateTime, title };
          }
        }
        return undefined;
      },
      { metaList: SELECTORS.purchase.metaList },
    )
    .catch(() => undefined)) as PurchaseMetaRaw | undefined;

  if (raw === undefined) return undefined;
  const meta = parsePurchaseMeta(raw);

  const performanceId = options.performanceId ?? parsePerformanceIdFromUrl(page.url());
  if (performanceId !== undefined) {
    meta.performanceIdFromUrl = performanceId;
  }
  return meta;
}

export const TRANSACTION_HOST = "transaction.ticket-cinemasunshine.com";
const TRANSACTION_PATH_PATTERN =
  /^\/projects\/sskts-production\/purchase\/transaction\/(\d{23,24})$/;

export function parsePerformanceIdFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.host !== TRANSACTION_HOST) return undefined;

  const fromQuery = parsed.searchParams.get("performanceId");
  if (fromQuery !== null && /^\d{23,24}$/.test(fromQuery)) return fromQuery;

  const match = TRANSACTION_PATH_PATTERN.exec(parsed.pathname);
  return match?.[1];
}
