import { parseArgs } from "node:util";
import {
  checkLogin,
  launchPersistentContext,
} from "../src/adapters/cinemasunshine/browser-session.js";
import { PurchasePage } from "../src/adapters/cinemasunshine/purchase-page.js";
import {
  assertSeatStateCount,
  captureSeatState,
  captureTheaterLayout,
  readSeatMap,
  requireSeatState,
  SeatStateUnavailableError,
} from "../src/adapters/cinemasunshine/seat-map.js";
import { loadConfig } from "../src/config.js";
import {
  parseAdjacentOption,
  parseMaxSurchargeOption,
  parseTargetRowRatioOption,
  parseTicketsOption,
  parseTopOption,
} from "../src/services/dry-run-options.js";
import { rankSeatGroups, summarizeSeats } from "../src/services/seat-ranking-service.js";

const OPTIONS = {
  performance: { type: "string" },
  tickets: { type: "string" },
  adjacent: { type: "string" },
  "seat-type": { type: "string", multiple: true },
  "exclude-seat-type": { type: "string", multiple: true },
  "max-surcharge": { type: "string" },
  "target-row-ratio": { type: "string" },
  top: { type: "string" },
  verbose: { type: "boolean" },
} as const;

function splitList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
  });
  const performanceId = values.performance ?? process.argv[2];
  if (performanceId === undefined || !/^\d{23,24}$/.test(performanceId)) {
    throw new Error(
      "Usage: npm run dry-run -- --performance <id> [--tickets N] [--seat-type standard] ...",
    );
  }

  const ticketCount = parseTicketsOption(values.tickets);
  const requireAdjacent = parseAdjacentOption(values.adjacent);
  const maxSurchargeYen = parseMaxSurchargeOption(values["max-surcharge"]);
  const targetRowRatio = parseTargetRowRatioOption(values["target-row-ratio"]);
  const top = parseTopOption(values.top);

  const config = loadConfig();
  const context = await launchPersistentContext({
    profileDir: config.browserProfileDir,
    headless: config.headless,
    channel: config.browserChannel,
  });

  try {
    const login = await checkLogin(context);
    if (!login.loggedIn) {
      process.stdout.write(`未登录（${login.status}），请先运行 npm run login\n`);
      process.exitCode = 1;
      return;
    }

    const page = context.pages()[0] ?? (await context.newPage());
    const capture = captureSeatState(page);
    const layoutCapture = captureTheaterLayout(page);
    const purchase = new PurchasePage(page, { preflightLogin: false });
    const inspection = await purchase.openPurchase(performanceId);
    if (inspection.state !== "ready") {
      process.stdout.write(`无法进入座位页：${inspection.state} ${inspection.url}\n`);
      process.exitCode = 2;
      return;
    }

    const seatState = requireSeatState(await capture.waitForSeatState(20_000));
    const {
      seats,
      legend,
      screenSide: domScreenSide,
      screenCenterX,
      screenWidth,
    } = await readSeatMap(page, seatState);
    assertSeatStateCount(seatState, seats);

    const layout = await layoutCapture.waitForScreenSide(5_000);
    const screenSide = layout.screenSide !== "unknown" ? layout.screenSide : domScreenSide;
    const screenSource =
      layout.screenSide !== "unknown" ? "layout" : domScreenSide !== "unknown" ? "dom" : "none";

    const summary = summarizeSeats(seats);
    process.stdout.write(
      `座位总数 ${summary.total} / 可售 ${summary.available} / 可选 ${summary.selectable} / 轮椅 ${summary.wheelchair}\n`,
    );
    process.stdout.write(
      `银幕方向：${screenSide}（来源 ${screenSource}${
        layout.screenY !== undefined ? `, screenY=${layout.screenY}` : ""
      }${layout.seatStartY !== undefined ? `, seatStartY=${layout.seatStartY}` : ""}）\n`,
    );
    process.stdout.write(
      `价格类型：${legend.map((entry) => entry.rawPriceText).join(" | ") || "(none)"}\n`,
    );
    for (const type of summary.byType) {
      process.stdout.write(
        `  ${type.seatType}${type.priceCategory !== undefined ? ` (${type.priceCategory})` : ""} surcharge=${
          type.surchargeYen ?? "unknown"
        } available=${type.available}/${type.total}\n`,
      );
    }

    if (values.verbose === true) {
      for (const seat of seats) {
        process.stdout.write(
          `  ${seat.row}${seat.number} ${seat.seatType} available=${seat.available} selectable=${seat.selectable}${
            seat.surchargeYen !== undefined ? ` +${seat.surchargeYen}` : ""
          }\n`,
        );
      }
    }

    if (screenSide === "unknown") {
      process.stdout.write("无法确认银幕方向，安全停止，不输出位置评分的推荐。\n");
      process.exitCode = 3;
      return;
    }

    const groups = rankSeatGroups(seats, {
      ticketCount,
      requireAdjacent,
      screenSide,
      ...(screenCenterX !== undefined ? { screenCenterX } : {}),
      ...(screenWidth !== undefined ? { screenWidth } : {}),
      targetRowRatio,
      maxSurchargeYen,
      ...(splitList(values["seat-type"]) !== undefined
        ? { allowedSeatTypes: splitList(values["seat-type"]) }
        : {}),
      ...(splitList(values["exclude-seat-type"]) !== undefined
        ? { excludedSeatTypes: splitList(values["exclude-seat-type"]) }
        : {}),
    });

    process.stdout.write(
      `\n目标排 ${groups[0]?.targetRow ?? "-"}（银幕在${screenSide === "top" ? "上" : "下"}，向后 ${Math.round(
        targetRowRatio * 100,
      )}%）\n`,
    );
    process.stdout.write(`推荐 ${Math.min(top, groups.length)} 组（只读，未选座）：\n`);
    if (groups.length === 0) {
      process.stdout.write("  无可推荐座位（默认仅普通席且附加费为 0）\n");
    }
    for (const group of groups.slice(0, top)) {
      const labels = group.seats.map((seat) => `${seat.row}${seat.number}`).join(", ");
      const first = group.seats[0];
      process.stdout.write(
        `  score=${group.score} seats=[${labels}] type=${first?.seatType} category=${
          first?.priceCategory ?? "-"
        } surcharge=${first?.surchargeYen ?? "unknown"} basis="${first?.rawPriceText ?? "-"}"\n`,
      );
      process.stdout.write(`    reasons: ${group.reasons.join("; ")}\n`);
    }
  } catch (error) {
    if (error instanceof SeatStateUnavailableError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 4;
      return;
    }
    throw error;
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
