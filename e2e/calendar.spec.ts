import { expect, test, type Page } from "./fixtures";
import { formatInTimeZone } from "date-fns-tz";

import { signIn, status } from "./helpers";

const LISBON = "Europe/Lisbon";

async function logHeadline(page: Page, title: string, at: Date, importance: "Medium" | "High") {
  await page.getByRole("button", { name: "Log headline" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Headline").fill(title);
  await dialog.getByLabel("Date").fill(formatInTimeZone(at, LISBON, "yyyy-MM-dd"));
  await dialog.getByLabel("Time (Lisbon)").fill(formatInTimeZone(at, LISBON, "HH:mm"));
  await dialog.getByRole("radio", { name: importance }).click();
  await dialog.getByRole("button", { name: "Log headline" }).click();
  await expect(page.getByText("Headline logged")).toBeVisible();
}

async function deleteEvent(page: Page, title: string, date: string) {
  await page.goto(`/calendar?view=day&date=${date}`);
  await page.getByTestId("calendar-event").filter({ hasText: title }).click();
  await page.getByTestId("event-sheet").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("calendar-event").filter({ hasText: title })).toHaveCount(0);
}

test("quick-add preset converts ET to Lisbon; edit, delete and undo", async ({ page }) => {
  await signIn(page, "/calendar");
  // A date well in the future, in EDT, with no DST gap vs Lisbon (both on summer time).
  const date = `20${30 + Math.floor(Math.random() * 9)}-07-10`;
  await page.goto(`/calendar?view=day&date=${date}`);
  await page.getByRole("button", { name: "Quick add" }).click();
  await page.getByRole("dialog").getByLabel("Date").fill(date);
  await page.getByRole("button", { name: /^CPI/ }).click();
  await expect(page.getByText(/Added CPI/)).toBeVisible();

  const cpi = page.getByTestId("calendar-event").filter({ hasText: "CPI" }).last();
  await expect(cpi).toContainText("13:30");
  await expect(cpi).toContainText("08:30 NY");

  await cpi.click();
  const sheet = page.getByTestId("event-sheet");
  await expect(sheet.getByTestId("event-lisbon-time")).toContainText("13:30");
  const actual = `${Date.now() % 100000}%`;
  await sheet.getByLabel("Actual").fill(actual);
  await sheet.getByRole("button", { name: "Save event" }).click();
  const edited = page.getByTestId("calendar-event").filter({ hasText: `A: ${actual}` });
  await expect(edited).toHaveCount(1);

  const before = await page.getByTestId("calendar-event").filter({ hasText: "CPI" }).count();
  await edited.click();
  await sheet.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("calendar-event").filter({ hasText: "CPI" })).toHaveCount(
    before - 1,
  );
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Deleted CPI" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByTestId("calendar-event").filter({ hasText: "CPI" })).toHaveCount(before);
});

test("generated FLOW dates are on the calendar and marked", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar?view=week&date=2026-12-14");
  const opex = page.getByTestId("calendar-event").filter({ hasText: "Quad witching" });
  await expect(opex).toHaveCount(1);
  await expect(opex).toContainText("generated");
  await expect(
    page.getByTestId("calendar-event").filter({ hasText: "VIX expiration" }),
  ).toHaveCount(1);
});

test("be-flat banner shows before a high-impact event; trade links to it", async ({ page }) => {
  await signIn(page, "/calendar");
  const title = `Tariff headline ${Date.now()}`;
  const at = new Date(Date.now() + 5 * 60_000);
  await logHeadline(page, title, at, "High");

  const banner = page.getByTestId("be-flat-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(`${title} in`);
  await expect(banner).toContainText("be flat");

  // The banner is app-wide.
  await page.goto("/journal");
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // Link a trade to the event.
  await page.goto("/journal/new");
  await page.getByRole("radio", { name: "ES", exact: true }).click();
  await page.getByRole("radio", { name: /Long/ }).click();
  await page.getByLabel("Entry price *").fill("5000");
  await page.getByLabel("Exit price *").fill("5001");
  await page.getByRole("radio", { name: /News/ }).click();
  await page.getByRole("button", { name: "More details" }).click();
  const eventSelect = page.getByLabel("Event");
  await expect(eventSelect.locator("option", { hasText: title })).toHaveCount(1);
  const value = await eventSelect.locator("option", { hasText: title }).getAttribute("value");
  await eventSelect.selectOption(value!);
  await expect(page.getByText(/· -\d+ min/)).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "More details" }).click();
  await expect(page.getByLabel("Event")).toHaveValue(value!);

  await deleteEvent(page, title, formatInTimeZone(at, LISBON, "yyyy-MM-dd"));
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
});

test("recurring template on → occurrences appear; off → removed", async ({ page }) => {
  await signIn(page, "/settings/calendar");
  const toggle = page.getByLabel("EIA crude inventories on calendar");
  await toggle.check();
  await expect(page.getByLabel("Saved").first()).toBeVisible();

  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 2, 1);
  const month = next.toISOString().slice(0, 7);
  await page.goto(`/calendar?view=month&date=${month}-01`);
  await expect(page.getByText("EIA crude inventories").first()).toBeVisible();

  await page.goto("/settings/calendar");
  await page.getByLabel("EIA crude inventories on calendar").uncheck();
  await expect(page.getByLabel("Saved").first()).toBeVisible();
  await page.goto(`/calendar?view=month&date=${month}-01`);
  await expect(page.getByText("EIA crude inventories")).toHaveCount(0);
});
