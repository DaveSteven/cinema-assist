import type { BrowserContext, Page } from "playwright";

export class AssistPageClosedError extends Error {
  constructor(message = "浏览器或页面已被关闭，assist 安全停止") {
    super(message);
    this.name = "AssistPageClosedError";
  }
}

export async function openAssistPage(context: BrowserContext): Promise<Page> {
  let page: Page;
  try {
    page = await context.newPage();
  } catch (error) {
    throw new AssistPageClosedError(
      `无法创建 assist 页面：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (page.isClosed()) {
    throw new AssistPageClosedError();
  }
  return page;
}

export function isPageUsable(page: Page): boolean {
  return !page.isClosed();
}
