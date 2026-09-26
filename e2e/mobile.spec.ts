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

test("mobile: session prep is usable one-handed", async ({ page }) => {
  await signIn(page);
  await page.goto("/prep/2039-03-15/eu");
  await page.getByRole("radiogroup", { name: "sleep" }).getByRole("radio", { name: "4" }).click();
  await page.getByRole("button", { name: "Add level" }).click();
  const row = page.getByTestId("level-row").last();
  await row.getByLabel("Price (or zone low)").fill("5000");
  await row.getByLabel("Level type").fill("POC");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });
});

test("mobile: debrief grades save on a phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/review/2039-03-16");
  await page
    .getByRole("radiogroup", { name: "Process grade" })
    .getByRole("radio", { name: "B", exact: true })
    .click();
  await page.getByLabel("Lesson of the day (one sentence)").fill("Stay patient");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });
});

test("mobile: open a playbook and edit its summary", async ({ page }) => {
  await signIn(page, "/playbook");
  await page.getByTestId("playbook-card").first().click();
  await page.getByRole("radio", { name: "Edit" }).click();
  await page.getByLabel("One-line summary").fill(`Checked on the phone ${Date.now()}`);
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });
});
