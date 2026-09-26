import { expect, test, type Page } from "@playwright/test";

import { E2E_USER, signedIn } from "../tests/local-supabase";
import { signIn } from "./helpers";

/**
 * Seeds 12 ES trades on a fresh playbook (as the E2E user, local stack only):
 * 8 Tuesday longs at +2R (confidence 4) and 4 Thursday shorts at −1R (confidence 2), no fees.
 * Expectancy (16 − 4) / 12 = +1.00R, win rate 8/12 = 67%.
 */
async function seed(name: string) {
  const { client } = await signedIn(E2E_USER);
  const { data: es, error: e1 } = await client
    .from("instruments")
    .select("id")
    .eq("symbol", "ES")
    .is("deleted_at", null)
    .single();
  if (e1) throw e1;
  const { data: pb, error: e2 } = await client
    .from("playbooks")
    .insert({ name, primary_domain: "DATA", status: "testing" })
    .select("id")
    .single();
  if (e2) throw e2;
  const tuesdays = ["02", "09", "16", "23", "30"].map((d) => `2021-03-${d}`);
  tuesdays.push("2021-04-06", "2021-04-13", "2021-04-20");
  const thursdays = ["04", "11", "18", "25"].map((d) => `2021-03-${d}`);
  const base = {
    instrument_id: es.id,
    playbook_id: pb.id,
    primary_domain: "DATA",
    contracts: 1,
    fees: 0,
  };
  const rows = [
    ...tuesdays.map((d) => ({
      ...base,
      direction: "long",
      confidence: 4,
      entry_at: `${d}T15:00:00Z`,
      exit_at: `${d}T15:10:00Z`,
      entry_price: 5000,
      stop_price: 4998,
      exit_price: 5004,
    })),
    ...thursdays.map((d) => ({
      ...base,
      direction: "short",
      confidence: 2,
      entry_at: `${d}T15:00:00Z`,
      exit_at: `${d}T15:05:00Z`,
      entry_price: 5000,
      stop_price: 5002,
      exit_price: 5002,
    })),
  ];
  const { error: e3 } = await client.from("trades").insert(rows);
  if (e3) throw e3;
}

async function pickPlaybook(page: Page, name: string) {
  await page.getByRole("button", { name: /^Playbook:/ }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("Escape");
}

test("filter, save and apply a view, click through a breakdown, mine patterns", async ({
  page,
}) => {
  const name = `Insights E2E ${Date.now()}`;
  await seed(name);
  await signIn(page, "/insights");

  await pickPlaybook(page, name);
  await expect(page).toHaveURL(/[?&]pb=/);
  await expect(page.getByTestId("kpi-n")).toContainText("12");
  await expect(page.getByTestId("kpi-expectancy")).toContainText("+1.00R");
  await expect(page.getByTestId("kpi-win")).toContainText("67%");
  await expect(page.getByTestId("kpi-net-r")).toContainText("+12.00R");
  await expect(page.getByTestId("insights-equity")).toContainText("n=12");

  // Save the view, start clean, apply it; the filter survives a reload (URL).
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByLabel("View name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Saved view “${name}”`)).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByTestId("filter-chips")).toHaveCount(0);
  await page.getByTestId("views-button").click();
  await page.getByTestId("views-list").getByRole("button", { name, exact: true }).click();
  await expect(page.getByTestId("kpi-n")).toContainText("12");
  await page.reload();
  await expect(page.getByTestId("kpi-n")).toContainText("12");
  await expect(page.getByTestId("filter-chips")).toContainText(`Playbook: ${name}`);

  // Breakdown by direction → click through to the 8 longs.
  await page.getByRole("tab", { name: "Breakdowns" }).click();
  await page.getByLabel("Breakdown dimension").selectOption("direction");
  await expect(page).toHaveURL(/tab=breakdowns/);
  await expect(page).toHaveURL(/by=direction/);
  const table = page.getByTestId("breakdown-table");
  const long = table.getByTestId("metrics-row").filter({ hasText: "Long" });
  await expect(long).toContainText("+2.00R");
  await expect(table.getByTestId("metrics-row").filter({ hasText: "Short" })).toContainText(
    "−1.00R",
  );
  await long.getByRole("button", { name: /Show 8 trades/ }).click();
  const sheet = page.getByTestId("drill-sheet");
  await expect(sheet.getByTestId("drill-list").getByRole("link")).toHaveCount(8);
  await sheet.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/journal\?trade=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("trade-detail")).toContainText("+2.00R");
  await page.goBack();

  // Pattern finder: min n 8 keeps the Tuesday pattern, hides the 4-trade leak.
  await page.goto(page.url().replace(/tab=breakdowns(&by=direction)?/, "tab=patterns"));
  await expect(page.getByTestId("pattern-baseline")).toContainText("12 trades with R");
  const strongest = page.getByTestId("patterns-strongest");
  await expect(strongest).toContainText("Weekday: Tue");
  await expect(page.getByTestId("patterns-leaks")).toHaveCount(0);
  await expect(page.getByText("Hypothesis to test")).toBeVisible();

  await page.getByLabel("Minimum n (trades with R)").fill("4");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Minimum n set to 4")).toBeVisible();
  await expect(page.getByTestId("patterns-leaks")).toContainText("Weekday: Thu");

  // "Filter to this" narrows the global filter.
  await strongest
    .getByTestId("pattern")
    .filter({ hasText: "Weekday: Tue" })
    .first()
    .getByRole("button", { name: /^Filter to/ })
    .click();
  await expect(page.getByTestId("filter-chips")).toContainText("Weekday: Tue");
  await expect(page.getByTestId("pattern-baseline")).toContainText("8 trades with R");

  // Restore the default for other runs.
  await page.getByLabel("Minimum n (trades with R)").fill("8");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Minimum n set to 8")).toBeVisible();

  // Process tab renders with the seeded (ungraded) trades.
  await page.getByRole("tab", { name: "Process" }).click();
  await expect(page.getByTestId("quad-good-good")).toBeVisible();
  await page.getByRole("tab", { name: "Plan accuracy" }).click();
  await expect(page.getByTestId("plan-table")).toContainText("Not linked");
});
