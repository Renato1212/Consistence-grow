import { expect, test, type Page } from "./fixtures";

import { isoWeekKey, isoWeekOf } from "../src/lib/calendar/dates";
import { fillQuickTrade, signIn, status } from "./helpers";

function randomWeekday(): string {
  for (;;) {
    const d = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
    const w = d.getUTCDay();
    if (w >= 1 && w <= 4) return d.toISOString().slice(0, 10);
  }
}

function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function saved(page: Page) {
  await expect(status(page).first()).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
}

test("daily loop: prep → trade → debrief → action item in Today and next prep → weekly review", async ({
  page,
}) => {
  const date = randomWeekday();
  const marker = `Wait for the retest ${Date.now()}`;
  await signIn(page);

  // Prep with a level and a scenario.
  await page.goto(`/prep/${date}/us`);
  await page.getByRole("button", { name: "Add level" }).click();
  const row = page.getByTestId("level-row").last();
  await row.getByLabel("Price (or zone low)").fill("5000");
  await row.getByLabel("Level type").fill("PDH");
  await row.getByRole("radio", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "Add scenario" }).click();
  await page.getByLabel("If…").fill("Opens above PDH");
  await page.getByLabel("Then…").fill("Buy the first pullback");
  await saved(page);

  // A trade on that day.
  await page.goto("/journal/new");
  await fillQuickTrade(page, "5000", "5004");
  await page.locator("#entryAt").fill(`${date}T15:40`);
  await page.locator("#exitAt").fill(`${date}T15:55`);
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByLabel("Stop", { exact: true }).fill("4998");
  await saved(page);

  // Debrief.
  await page.goto(`/review/${date}?full=1`);
  await expect(page.getByRole("heading", { name: "Debrief" })).toBeVisible();
  await expect(page.getByTestId("day-stats")).toContainText("1");
  await expect(page.getByRole("link", { name: /ES long/ })).toBeVisible();

  const scenario = page.getByTestId("debrief-scenario").first();
  await expect(scenario).toContainText("Opens above PDH");
  await scenario.getByRole("radio", { name: "Partially" }).click();
  await scenario
    .getByRole("radiogroup", { name: "Did I trade it?" })
    .getByRole("radio", { name: "Yes" })
    .click();
  const levels = page.getByTestId("debrief-levels");
  await levels
    .getByRole("radiogroup", { name: /tested/ })
    .getByRole("radio", { name: "Yes" })
    .click();
  await levels
    .getByRole("radiogroup", { name: /respected/ })
    .getByRole("radio", { name: "Yes" })
    .click();

  for (const [pillar, grade] of [
    ["Context", "A"],
    ["Edge", "B"],
    ["Process", "A"],
  ] as const) {
    await page
      .getByRole("radiogroup", { name: `${pillar} grade` })
      .getByRole("radio", { name: grade, exact: true })
      .click();
  }
  await page
    .getByRole("radiogroup", { name: /^Rule:/ })
    .first()
    .getByRole("radio", { name: "Broken" })
    .click();

  // A broken rule without a note blocks completion.
  await page.getByRole("button", { name: "Debrief complete" }).first().click();
  await expect(page.getByText(/To complete, add: note for broken rule/)).toBeVisible();
  await page.getByLabel(/Why was .* broken\?/).fill("Held a position into the release");

  await page.getByLabel("What went well 1").fill("Patience at the level");
  await page.getByLabel("Lesson of the day (one sentence)").fill(marker);
  await page.getByRole("button", { name: "Add action item" }).click();
  await page.getByLabel("Action item", { exact: true }).fill(`Flatten 2 min before data ${marker}`);
  await saved(page);

  await page.getByRole("button", { name: "Debrief complete" }).first().click();
  await expect(page.getByTestId("debrief-complete")).toBeVisible();
  await saved(page);

  await page.reload();
  await expect(page.getByLabel("Lesson of the day (one sentence)")).toHaveValue(marker);
  await expect(page.getByTestId("debrief-complete")).toBeVisible();
  await expect(
    page.getByTestId("debrief-scenario").first().getByRole("radio", { name: "Partially" }),
  ).toBeChecked();

  // The action item follows me: Today and the next prep.
  const itemText = `Flatten 2 min before data ${marker}`;
  await page.goto("/today");
  await expect(page.getByTestId("action-items")).toContainText(itemText);
  await page.goto(`/prep/${nextDay(date)}/eu`);
  const item = page.getByTestId("action-item").filter({ hasText: itemText });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: /done/i }).click();
  await expect(page.getByText("Marked done")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("action-item").filter({ hasText: itemText })).toHaveCount(0);

  // Weekly review of that week.
  const { year, week } = isoWeekOf(date);
  await page.goto(`/review/week/${isoWeekKey(year, week)}`);
  await expect(page.getByTestId("week-summary")).toContainText("1");
  await expect(page.getByTestId("insufficient").first()).toBeVisible();
  await expect(page.getByTestId("equity-curve")).toContainText("n=1");
  await page.getByLabel("Weekly reflection").fill(`Good process ${marker}`);
  await page.getByLabel("Goal 1").fill("Max 3 trades a day");
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Goal 1")).toHaveValue("Max 3 trades a day");
});

test("D opens today's debrief; the review page lists weeks", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/review\/\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { name: "Debrief" })).toBeVisible();
  await page.goto("/review");
  await expect(page.getByTestId("review-weeks").getByRole("link")).toHaveCount(8);
});
