import { expect, test } from "./fixtures";

import { signIn, status } from "./helpers";

test("fees set in Settings apply to new trades", async ({ page }) => {
  await signIn(page, "/settings/instruments");
  const fee = page.getByLabel("MES fee per contract");
  await fee.fill("1.24");
  await fee.blur();
  await expect(
    page.getByTestId("instrument-row").filter({ hasText: "MES" }).getByLabel("Saved"),
  ).toBeVisible();

  await page.goto("/journal/new");
  await page.getByRole("radio", { name: "MES", exact: true }).click();
  await page.getByRole("radio", { name: /Long/ }).click();
  await page.getByLabel("Entry price *").fill("5000");
  await page.getByLabel("Exit price *").fill("5001");
  await page.getByLabel("Contracts *").fill("2");
  await page.getByRole("radio", { name: /Technical/ }).click();
  // 4 ticks × $1.25 × 2 = $10 gross − 2 × $1.24 fees = $7.52 net
  await expect(page.getByTestId("live-preview")).toContainText("+$7.52");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  // Reset for other runs.
  await page.goto("/settings/instruments");
  await page.getByLabel("MES fee per contract").fill("0");
  await page.getByLabel("MES fee per contract").blur();
  await expect(
    page.getByTestId("instrument-row").filter({ hasText: "MES" }).getByLabel("Saved"),
  ).toBeVisible();
});

test("inactive instruments leave the quick picker", async ({ page }) => {
  await signIn(page, "/settings/instruments");
  const row = page.getByTestId("instrument-row").filter({ hasText: /^YM/ });
  const box = row.getByLabel("YM active");
  if (!(await box.isChecked())) {
    await box.check(); // known starting state (a previous run may have left it off)
    await expect(row.getByLabel("Saved")).toBeVisible();
  }
  await box.uncheck();
  await expect(row.getByLabel("Saved")).toBeVisible();
  await page.goto("/journal/new");
  await expect(page.getByRole("radio", { name: "YM", exact: true })).toHaveCount(0);
  await page.goto("/settings/instruments");
  await page
    .getByTestId("instrument-row")
    .filter({ hasText: /^YM/ })
    .getByLabel("YM active")
    .check();
});
