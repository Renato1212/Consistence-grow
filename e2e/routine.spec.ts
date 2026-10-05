import { getISOWeek, getISOWeekYear } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Page } from "@playwright/test";

import { E2E_USER, signedIn } from "../tests/local-supabase";
import { expect, test } from "./fixtures";
import { signIn, status } from "./helpers";

const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The day Today shows the routine for: today, or the next weekday. */
function routineDate() {
  let d = formatInTimeZone(new Date(), "Europe/Lisbon", "yyyy-MM-dd");
  while (isWeekend(d)) d = nextDay(d);
  return d;
}

function randomWeekday() {
  for (;;) {
    const d = new Date(Date.UTC(2041, 0, 1) + Math.floor(Math.random() * 2500) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

async function setups() {
  const { client } = await signedIn(E2E_USER);
  const { data } = await client
    .from("playbooks")
    .select("id, notes_json")
    .is("deleted_at", null)
    .not("notes_json->>routine_setup", "is", null);
  return Object.fromEntries(
    (data ?? []).map((p) => [(p.notes_json as { routine_setup: string }).routine_setup, p.id]),
  ) as Record<"euNews" | "usOpen" | "scalp" | "moc", string>;
}

async function resetRoutine(date: string) {
  const { client, userId } = await signedIn(E2E_USER);
  await client.from("user_settings").update({ routine: null }).eq("user_id", userId);
  await client.from("routine_days").delete().eq("date", date);
}

function block(page: Page, key: string) {
  return page.locator(`[data-testid="routine-block"][data-block="${key}"]`);
}

async function openBlock(page: Page, key: string) {
  const b = block(page, key);
  await b.evaluate((el) => ((el as HTMLDetailsElement).open = true));
  return b;
}

test("routine on Today: steps, 60-second prep, gates, one-tap log, guardrails", async ({
  page,
}) => {
  const date = routineDate();
  await resetRoutine(date);
  const pb = await setups();
  await signIn(page, "/today");
  await expect(page.getByTestId("routine")).toBeVisible();
  await expect(page.getByTestId("routine-block")).toHaveCount(7);

  // A step tick is saved and survives a reload.
  const prep = await openBlock(page, "eu_prep");
  const tick = prep.getByRole("checkbox", { name: "Read Claude Pre-Open (EU)" });
  await expect(tick).toHaveAttribute("aria-checked", "false");
  await tick.click();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  // 60-second prep: narrative, instrument, bias.
  const marker = `Yields up on hot CPI ${Date.now()}`;
  const form = prep.getByTestId("quick-prep-eu");
  await form.getByLabel("Narrative in one line").fill(marker);
  const es = form.getByRole("button", { name: "ES", exact: true });
  if ((await es.getAttribute("aria-pressed")) !== "true") await es.click();
  await form
    .getByRole("radiogroup", { name: "ES bias" })
    .getByRole("radio", { name: "Short" })
    .click();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  await page.reload();
  const prep2 = await openBlock(page, "eu_prep");
  await expect(prep2.getByRole("checkbox", { name: "Read Claude Pre-Open (EU)" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(prep2.getByLabel("Narrative in one line")).toHaveValue(marker);
  await expect(
    prep2.getByRole("radiogroup", { name: "ES bias" }).getByRole("radio", { name: "Short" }),
  ).toBeChecked();
  await expect(prep2.getByRole("checkbox", { name: /60-second prep/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // EU news gate: confirm "no EU trades today", then undo.
  const eu = await openBlock(page, "eu_news");
  await eu.getByRole("button", { name: "Confirm: no EU trades today" }).click();
  await expect(eu.getByTestId("no-trade-confirmed")).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await eu.getByRole("button", { name: "Undo" }).click();
  await expect(eu.getByTestId("no-trade-confirmed")).toHaveCount(0);

  // Scalp check: 3 taps set the bias, and logging from the block carries it.
  const scalp = await openBlock(page, "us_scalp");
  await scalp
    .getByRole("radiogroup", { name: "Winning side so far" })
    .getByRole("radio", { name: "Long" })
    .click();
  await scalp
    .getByRole("radiogroup", { name: "Trend day" })
    .getByRole("radio", { name: "Yes" })
    .click();
  await scalp
    .getByRole("radiogroup", { name: "Higher timeframe agrees" })
    .getByRole("radio", { name: "Yes" })
    .click();
  await expect(scalp.getByTestId("bias-result")).toContainText("go with the long side");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  const log = scalp.getByTestId("block-log");
  await expect(log).toHaveAttribute("href", new RegExp(`playbook=${pb.scalp}`));
  await expect(log).toHaveAttribute("href", /direction=long/);
  await log.click();
  await expect(page).toHaveURL(/\/journal\/new\?/);
  await expect(page.getByTestId("preset-setup")).toContainText("Midday scalp");
  await page.getByRole("button", { name: "More details" }).click();
  await expect(page.locator("#playbookId")).toHaveValue(pb.scalp);
  await expect(page.getByRole("radio", { name: /Long/ }).first()).toBeChecked();

  // Guardrails: a block at its trade limit is calmly "done".
  const { client, userId } = await signedIn(E2E_USER);
  await page.goto("/settings/routine");
  const openRow = page.locator('[data-testid="routine-block-editor"][data-block="us_open"]');
  await openRow.getByLabel("US open (1h plan) max trades").fill("0");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await page.goto("/today");
  const open = await openBlock(page, "us_open");
  await expect(open.getByTestId("block-stopped")).toContainText("Done for this block");
  await client.from("user_settings").update({ routine: null }).eq("user_id", userId);
});

test("2-minute debrief, weekly setup scorecard", async ({ page }) => {
  const date = randomWeekday();
  const pb = await setups();
  const { client } = await signedIn(E2E_USER);
  const es = await client
    .from("instruments")
    .select("id")
    .eq("symbol", "ES")
    .is("deleted_at", null)
    .single();
  const at = (wall: string, tz: string) => fromZonedTime(`${date} ${wall}`, tz).toISOString();
  const trade = (entry: string, exit: string, playbook: string | null) => ({
    instrument_id: es.data!.id,
    direction: "long",
    contracts: 1,
    fees: 0,
    entry_at: entry,
    exit_at: exit,
    entry_price: 5000,
    exit_price: 5002,
    stop_price: 4998,
    playbook_id: playbook,
  });
  const ins = await client
    .from("trades")
    .insert([
      trade(at("13:00", "America/New_York"), at("13:10", "America/New_York"), pb.scalp),
      trade(at("22:00", "Europe/Lisbon"), at("22:05", "Europe/Lisbon"), null),
    ]);
  expect(ins.error).toBeNull();

  await signIn(page, `/review/${date}`);
  const scalp = page.locator('[data-testid="debrief-block"][data-block="us_scalp"]');
  await expect(scalp.getByTestId("block-result")).toContainText("1 trade");
  await expect(page.getByTestId("outside-routine")).toContainText("1 trade outside the routine");

  await scalp
    .getByRole("radiogroup", { name: /Followed the plan/ })
    .getByRole("radio", { name: "Yes" })
    .click();
  await scalp.getByLabel(/Lesson:/).fill("Waited for the zone");
  await page
    .getByRole("radiogroup", { name: "Process grade" })
    .getByRole("radio", { name: "B", exact: true })
    .click();
  await page.getByLabel("Lesson of the day (one sentence)").fill("Patience pays");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("quick-debrief-complete")).toBeVisible();

  await page.reload();
  await expect(
    page
      .locator('[data-testid="debrief-block"][data-block="us_scalp"]')
      .getByRole("radio", { name: "Yes" }),
  ).toBeChecked();
  await expect(page.getByLabel("Lesson of the day (one sentence)")).toHaveValue("Patience pays");
  await expect(page.getByTestId("quick-debrief-complete")).toBeVisible();

  // The full debrief sees the same grade and lesson.
  await page.getByRole("link", { name: /full debrief/i }).click();
  await expect(page).toHaveURL(/\?full=1$/);
  await expect(
    page
      .getByRole("radiogroup", { name: "Process grade" })
      .getByRole("radio", { name: "B", exact: true }),
  ).toBeChecked();

  // Weekly scorecard: the setup's week, adherence and a verdict.
  const d = new Date(`${date}T12:00:00Z`);
  const week = `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
  await page.goto(`/review/week/${week}`);
  const row = page.locator(`[data-testid="setup-row"][data-playbook="${pb.scalp}"]`);
  await expect(row).toContainText("This week · n=1");
  await expect(row.getByTestId("setup-adherence")).toContainText("100% (1 yes");
  await row.getByRole("radio", { name: "Keep" }).click();
  await row.getByLabel(/Note:/).fill("Works with the trend");
  await expect(page.getByTestId("setup-scorecard").getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
    { timeout: 10_000 },
  );
  await page.reload();
  const row2 = page.locator(`[data-testid="setup-row"][data-playbook="${pb.scalp}"]`);
  await expect(row2.getByRole("radio", { name: "Keep" })).toBeChecked();
  await expect(row2.getByLabel(/Note:/)).toHaveValue("Works with the trend");
});

test("routine settings: edit, validate, reset; More menu", async ({ page }) => {
  const { client, userId } = await signedIn(E2E_USER);
  await client.from("user_settings").update({ routine: null }).eq("user_id", userId);
  await signIn(page, "/settings/routine");
  const row = page.locator('[data-testid="routine-block-editor"][data-block="us_scalp"]');
  await row.getByLabel("Midday scalp (1-min S/D) end").fill("15:30");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  const saved = await client.from("user_settings").select("routine").single();
  const blocks = (saved.data!.routine as { blocks: { key: string; end: string }[] }).blocks;
  expect(blocks.find((b) => b.key === "us_scalp")?.end).toBe("15:30");

  // An inverted window is shown and not saved.
  await row.getByLabel("Midday scalp (1-min S/D) end").fill("11:00");
  await expect(page.getByTestId("routine-issues")).toContainText("End must be after start");
  await row.getByLabel("Midday scalp (1-min S/D) end").fill("15:00");
  await expect(page.getByTestId("routine-issues")).toHaveCount(0);

  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await client.from("user_settings").update({ routine: null }).eq("user_id", userId);

  // Desktop "More" holds the rest of the app.
  await page
    .getByRole("navigation", { name: "Main" })
    .first()
    .getByRole("button", { name: "More" })
    .click();
  await page.getByRole("link", { name: "Statements" }).click();
  await expect(page).toHaveURL(/\/statements$/);
});
