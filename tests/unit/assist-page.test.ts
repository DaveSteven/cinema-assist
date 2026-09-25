import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  AssistPageClosedError,
  isPageUsable,
  openAssistPage,
} from "../../src/adapters/cinemasunshine/assist-page.js";

function fakeContext(options: { pageClosed?: boolean; newPageError?: Error }): BrowserContext {
  const page = { isClosed: () => options.pageClosed ?? false } as unknown as Page;
  return {
    newPage: async () => {
      if (options.newPageError !== undefined) throw options.newPageError;
      return page;
    },
  } as unknown as BrowserContext;
}

describe("openAssistPage", () => {
  it("creates a dedicated page", async () => {
    const page = await openAssistPage(fakeContext({}));
    expect(page).toBeDefined();
  });

  it("throws when the new page is already closed", async () => {
    await expect(openAssistPage(fakeContext({ pageClosed: true }))).rejects.toBeInstanceOf(
      AssistPageClosedError,
    );
  });

  it("throws when the context cannot create a page", async () => {
    await expect(
      openAssistPage(fakeContext({ newPageError: new Error("context closed") })),
    ).rejects.toBeInstanceOf(AssistPageClosedError);
  });

  it("reports page usability", () => {
    expect(isPageUsable({ isClosed: () => false } as unknown as Page)).toBe(true);
    expect(isPageUsable({ isClosed: () => true } as unknown as Page)).toBe(false);
  });
});
