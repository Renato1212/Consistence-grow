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
