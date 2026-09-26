import { expect, test, type Page } from "@playwright/test";

import { status, signIn } from "./helpers";

/** A random far-future weekday so repeated runs never share a prep. */
function randomWeekday(): string {
  for (;;) {
    const d = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
    const w = d.getUTCDay();
    if (w >= 1 && w <= 4) return d.toISOString().slice(0, 10); // Mon–Thu: next day is a weekday
  }
}

function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function saved(page: Page) {
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
}

async function addLevel(page: Page, price: string, type: string, strength: "1" | "2" | "3") {
  await page.getByRole("button", { name: "Add level" }).click();
  const row = page.getByTestId("level-row").last();
  await row.getByLabel("Price (or zone low)").fill(price);
  await row.getByLabel("Level type").fill(type);
  await row.getByRole("radio", { name: strength, exact: true }).click();
}

test("EU prep autosaves the whole snapshot and survives a reload", async ({ page }) => {
  const date = randomWeekday();
  await signIn(page);
  await page.goto(`/prep/${date}/eu`);
  await expect(page.getByRole("heading", { name: "EU prep" })).toBeVisible();

  // Prep complete needs readiness first.
  await page.getByRole("button", { name: "Prep complete" }).first().click();
  await expect(page.getByText(/Fill the readiness check first/)).toBeVisible();

  for (const [group, score] of [
    ["sleep", "4"],
    ["energy", "3"],
    ["focus", "5"],
  ] as const) {
    await page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: score }).click();
  }
  await page.getByLabel("Narrative — what is the market focused on?").fill("CPI week");
  await addLevel(page, "5800", "PDH", "3");
  await addLevel(page, "5750.5", "Beginning zone", "1");
  await page.getByRole("button", { name: "Add scenario" }).click();
  await page.getByLabel("If…").fill("Hot CPI and 5800 fails");
  await page.getByLabel("Then…").fill("Short the retest");
  await page.getByLabel("Max daily loss ($)").fill("500");
  await page.getByTestId("prep-rules").getByRole("checkbox").first().check();
  await saved(page);

  await page.reload();
  await expect(page.getByLabel("Narrative — what is the market focused on?")).toHaveValue(
    "CPI week",
  );
  await expect(page.getByTestId("level-row")).toHaveCount(2);
  // Strongest first after reload.
  await expect(page.getByTestId("level-row").first()).toHaveAttribute("data-strength", "3");
  await page.getByLabel("Hide strength 1 (1)").check();
  await expect(page.getByTestId("level-row")).toHaveCount(1);
  await expect(page.getByLabel("If…")).toHaveValue("Hot CPI and 5800 fails");
  await expect(page.getByTestId("prep-rules").getByRole("checkbox").first()).toBeChecked();

  await page.getByRole("button", { name: "Prep complete" }).first().click();
  await expect(page.getByTestId("prep-complete")).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(page.getByTestId("prep-complete")).toBeVisible();
});

test("US prep copies the EU prep forward; next day carries untested levels", async ({ page }) => {
  const date = randomWeekday();
  await signIn(page);
  await page.goto(`/prep/${date}/eu`);
  await page.getByLabel("Market regime").fill("Trending");
  await addLevel(page, "20100", "VAH", "2");
  await page.getByRole("button", { name: "Add scenario" }).click();
  await page.getByLabel("If…").fill("Opens above VAH");
  await page.getByLabel("Then…").fill("Buy the first pullback");
  await saved(page);

  await page.getByRole("link", { name: "US prep" }).click();
  await expect(page.getByRole("heading", { name: "US prep" })).toBeVisible();
  await page.getByRole("button", { name: "Copy from EU prep" }).click();
  await expect(page.getByLabel("Market regime")).toHaveValue("Trending");
  await expect(page.getByTestId("level-row")).toHaveCount(1);
  await expect(page.getByLabel("If…")).toHaveValue("Opens above VAH");
  await saved(page);
  await expect(page.getByRole("button", { name: "Copy from EU prep" })).toHaveCount(0);

  // Next trading day: carry forward the untested level (from the US prep).
  await page.goto(`/prep/${nextDay(date)}/eu`);
  await page.getByRole("button", { name: /Carry forward 1 untested/ }).click();
  await expect(page.getByTestId("level-row")).toHaveCount(1);
  await expect(page.getByTestId("level-row").getByLabel("Price (or zone low)")).toHaveValue(
    "20100",
  );
  await saved(page);
  await expect(page.getByRole("button", { name: /Carry forward/ })).toHaveCount(0);
});

test("brief renders markdown", async ({ page }) => {
  await signIn(page);
  await page.goto(`/prep/${randomWeekday()}/us`);
  await page
    .getByLabel("Pre-session brief (markdown)")
    .fill("## Macro\n\n- **CPI** 08:30 ET\n- Fed speakers");
  await page.getByRole("radio", { name: "Read" }).click();
  const brief = page.getByTestId("brief-rendered");
  await expect(brief.getByRole("heading", { name: "Macro" })).toBeVisible();
  await expect(brief.locator("strong")).toHaveText("CPI");
  await saved(page);
});
