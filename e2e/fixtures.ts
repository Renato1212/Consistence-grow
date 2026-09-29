import { test as base, type Page } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

/**
 * After a full page load React may keep the streamed page's hidden copy
 * (`<div hidden id="S:…">`) for a few hundred ms before revealing it. Users
 * never see it, but it doubles every element for strict locators, so page
 * loads here wait until streaming has settled.
 */
async function settled(page: Page) {
  await page
    .waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, {
      timeout: 10_000,
    })
    .catch(() => {});
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...args: Parameters<Page["goto"]>) => {
      const res = await goto(...args);
      await settled(page);
      return res;
    };
    page.reload = async (...args: Parameters<Page["reload"]>) => {
      const res = await reload(...args);
      await settled(page);
      return res;
    };
    await provide(page);
  },
});
