import type { Screening } from "../domain/screening.js";
import type { NotificationEvent, Notifier } from "../services/notification-service.js";

function describeScreening(screening: Screening): string {
  const parts = [
    screening.movieTitle,
    `${screening.startsAt} (JST)`,
    screening.screenName,
    screening.formatLabels.length > 0 ? screening.formatLabels.join("/") : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" | ");
}

export function formatNotification(event: NotificationEvent): string {
  const tag = `[rule ${event.rule.id}]`;
  switch (event.type) {
    case "started":
      return `${tag} 开始监听「${event.rule.movieTitlePattern}」@ ${event.rule.targetDate}；预计开售 ${event.expectedSaleOpensAt}`;
    case "waiting_for_schedule":
      return `${tag} 排片尚未发布，继续低频等待`;
    case "waiting_for_sale":
      return `${tag} 已找到场次：${describeScreening(event.screening)}；尚未开售（预计 ${event.expectedSaleOpensAt}）`;
    case "sales_open":
      return `${tag} 已开售：${describeScreening(event.screening)}；请立即前往浏览器手动完成购票（本工具不会自动付款）`;
    case "assist_ready": {
      const labels = event.seats.map((seat) => `${seat.row}${seat.number}`).join(", ");
      return `${tag} assist 已就绪：${describeScreening(event.screening)}；推荐座位 [${labels}] 类型 ${event.seatType}${
        event.priceCategory !== undefined ? `/${event.priceCategory}` : ""
      }${event.surchargeYen !== undefined ? ` (+¥${event.surchargeYen})` : ""}；请在浏览器中手动选座并继续（本工具不会自动锁座或付款）`;
    }
    case "sold_out":
      return `${tag} 目标场次已售罄：${describeScreening(event.screening)}`;
    case "no_match":
      return `${tag} 未找到匹配场次${event.reason !== undefined ? `：${event.reason}` : ""}`;
    case "rate_limited":
      return `${tag} 被限流/拒绝，退避重试：${event.message}`;
    case "error":
      return `${tag} 监听出错：${event.message}`;
    case "cancelled":
      return `${tag} 监听已取消`;
  }
}

export type ConsoleNotifierOptions = {
  write?: (line: string) => void;
  now?: () => Date;
};

export function createConsoleNotifier(options: ConsoleNotifierOptions = {}): Notifier {
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const now = options.now ?? (() => new Date());

  return {
    notify(event: NotificationEvent): Promise<void> {
      write(`${now().toISOString()} ${formatNotification(event)}`);
      return Promise.resolve();
    },
  };
}
