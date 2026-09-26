import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

test("mobile: bottom nav and log-trade button are reachable", async ({ page }) => {
  await signIn(page);
  const bottomNav = page.getByRole("navigation", { name: "Main" }).last();
  await expect(bottomNav).toBeVisible();
  await bottomNav.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/review$/);

  await page.getByRole("link", { name: /Log trade/ }).click();
  await expect(page).toHaveURL(/\/journal\/new$/);
});

test("mobile: log a trade one-handed and see it as a card", async ({ page }) => {
  await signIn(page, "/journal/new");
  await page.getByRole("radio", { name: "ES", exact: true }).click();
  await page.getByRole("radio", { name: /Short/ }).click();
  await page.getByLabel("Entry price *").fill("5500");
  await page.getByLabel("Exit price *").fill("5497.5");
  await page.getByRole("radio", { name: /Flow/ }).click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("trade-detail")).toContainText("+$125.00");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("journal-card").first()).toBeVisible();
});
