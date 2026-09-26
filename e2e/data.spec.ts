import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

import { signIn } from "./helpers";

function randomWeekday(): { mdy: string; iso: string } {
  for (;;) {
    const d = new Date(Date.UTC(2034, 0, 1) + Math.floor(Math.random() * 2500) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) {
      const iso = d.toISOString().slice(0, 10);
      const [y, m, day] = iso.split("-");
      return { mdy: `${m}/${day}/${y}`, iso };
    }
  }
}

/**
 * Rithmic-style fills: an ES long scaled out (1 trade), an MES short that
 * reverses into a long (2 trades), an unknown ZW (wheat) fill, and an ES position
 * left open at the end.
 */
function csv(day: string) {
  const t = (hms: string) => `${day} ${hms}`;
  return [
    "Account,Symbol,B/S,Qty,Fill Price,Update Time,Commission",
    `SIM1,ESZ6,B,2,5000.00,${t("09:31:00")},4.10`,
    `SIM1,ESZ6,S,1,5004.00,${t("09:35:00")},2.05`,
    `SIM1,ESZ6,S,1,5006.00,${t("09:40:00")},2.05`,
    `SIM1,MESZ6,S,1,5010.00,${t("10:00:00")},0.62`,
    `SIM1,MESZ6,B,2,5000.00,${t("10:05:00")},1.24`,
    `SIM1,MESZ6,S,1,5002.50,${t("10:10:00")},0.62`,
    `SIM1,ZWZ6,B,1,580.00,${t("10:15:00")},2.00`,
    `SIM1,ESZ6,B,1,5001.00,${t("11:00:00")},2.05`,
  ].join("\n");
}

async function upload(page: Page, name: string, content: string) {
  await page.getByLabel("CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
}

test("import fills twice without duplicates, save a preset, export and back up", async ({
  page,
}) => {
  const { mdy } = randomWeekday();
  const content = csv(mdy);
  const preset = `E2E Rithmic ${Date.now()}`;

  await signIn(page, "/settings/import");
  await upload(page, "fills.csv", content);
  await expect(page.getByTestId("import-rows")).toContainText("8 rows");
  // Columns guessed from the headers.
  await expect(page.getByLabel("Column for Buy/Sell")).toHaveValue("B/S");
  await expect(page.getByLabel("Column for Price")).toHaveValue("Fill Price");
  await expect(page.getByTestId("unknown-symbols")).toContainText("ZWZ6");
  await expect(page.getByTestId("import-parsed")).toContainText("7 fills read · 1 row with errors");

  await page.getByLabel("Preset name").fill(preset);
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText(`Preset “${preset}” saved`)).toBeVisible();

  await page.getByRole("button", { name: "Check against the journal" }).click();
  await expect(page.getByTestId("plan-create")).toHaveText("3 new trades");
  await expect(page.getByTestId("plan-duplicates")).toHaveText("0 already imported");
  await expect(page.getByTestId("plan-open")).toContainText("1 open position");
  const rows = page.getByTestId("plan-trades").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("ES long");
  await expect(rows.nth(0)).toContainText("5000 → 5005");
  await expect(rows.nth(1)).toContainText("MES short");
  await expect(rows.nth(2)).toContainText("MES long");

  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-result")).toContainText("3 imported");

  // Same file again, with the saved preset: nothing new.
  await page.goto("/settings/import");
  await page.getByLabel("Mapping preset").selectOption({ label: preset });
  await upload(page, "fills-again.csv", content);
  await page.getByRole("button", { name: "Check against the journal" }).click();
  await expect(page.getByTestId("plan-create")).toHaveText("0 new trades");
  await expect(page.getByTestId("plan-duplicates")).toHaveText("3 already imported");
  await expect(page.getByTestId("import-commit")).toBeDisabled();

  // Imported trades wait for review.
  await page.goto("/today");
  await expect(page.getByText(/imported trades? needs? tagging/)).toBeVisible();
  await page.goto("/journal?review=1");
  await expect(page.getByTestId("review-filter")).toHaveAttribute("aria-pressed", "true");

  // Export: a zip with JSON, CSVs and media links.
  await page.goto("/settings/data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-link").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^consistent-grow-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      "consistent-grow.json",
      "csv/trades.csv",
      "csv/fills.csv",
      "media-links.csv",
    ]),
  );
  const data = JSON.parse(strFromU8(files["consistent-grow.json"])) as {
    tables: { trades: { import_hash: string | null }[]; api_tokens: Record<string, unknown>[] };
  };
  expect(data.tables.trades.filter((t) => t.import_hash).length).toBeGreaterThanOrEqual(3);
  expect(data.tables.api_tokens.every((t) => !("token_hash" in t))).toBe(true);

  // Back up now → listed.
  await page.getByTestId("backup-now").click();
  await expect(page.getByText("Backup stored")).toBeVisible();
  await expect(page.getByTestId("backup-list").locator("li").first()).toBeVisible();

  // The cron route never runs without its secret.
  const cron = await page.request.get("/api/cron/backup");
  expect([401, 503]).toContain(cron.status());
  const forged = await page.request.get("/api/cron/backup", {
    headers: { Authorization: "Bearer guess" },
  });
  expect([401, 503]).toContain(forged.status());
});
