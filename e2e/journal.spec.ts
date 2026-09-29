import { expect, test } from "./fixtures";

import { logTrade, pasteImage, signIn } from "./helpers";

test("journal lists the trade; detail panel shows it with media", async ({ page }) => {
  await signIn(page);
  const marker = `journal-${Date.now()}`;
  const id = await logTrade(page, { entry: "5300", exit: "5302", thesis: marker });
  await pasteImage(page);
  await expect(page.getByTestId("media-item")).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/journal\\?trade=${id}$`));
  const detail = page.getByTestId("trade-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("+$100.00");
  await expect(detail).toContainText(marker);
  await expect(detail.getByTestId("media-gallery").getByRole("button")).toHaveCount(1);

  // Close and find it via "/" search.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/journal$/);
  await page.keyboard.press("/");
  await page.keyboard.type(marker);
  await expect(page.getByTestId("journal-row")).toHaveCount(1);
  await expect(page.getByTestId("pnl-heatmap")).toBeVisible();
});

test("delete → Undo, and delete → Trash → Restore", async ({ page }) => {
  await signIn(page);
  const marker = `trash-${Date.now()}`;
  const id = await logTrade(page, { entry: "5400", exit: "5399", thesis: marker });

  await page.goto(`/journal?trade=${id}`);
  await page.getByTestId("trade-detail").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Trade moved to trash")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByLabel("Search trades (/)").fill(marker);
  await expect(page.getByTestId("journal-row")).toHaveCount(1);

  await page.goto(`/journal?trade=${id}`);
  await page.getByTestId("trade-detail").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await page.getByLabel("Search trades (/)").fill(marker);
  await expect(page.getByTestId("journal-row")).toHaveCount(0);

  await page.getByRole("link", { name: "Trash" }).click();
  const item = page.getByTestId("trash-item").filter({ hasText: "ES long" }).first();
  await expect(item).toBeVisible();
  await page.goto(`/journal/${id}`);
  await expect(page.getByText("This trade is in the trash")).toBeVisible();
  await page.goto("/journal/trash");
  const count = await page.getByTestId("trash-item").count();
  await page.getByTestId("trash-item").first().getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("trash-item")).toHaveCount(count - 1);
});
