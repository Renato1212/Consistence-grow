import { expect, test } from "./fixtures";

import {
  DEFAULT_PRODUCTS,
  MES_THREE_TRADES_PRODUCT,
  buildAxiaStatementPdf,
} from "../tests/fixtures/axia-statement";
import { E2E_USER, signedIn } from "../tests/local-supabase";
import { signIn, status } from "./helpers";

function randomWeekday(): string {
  for (;;) {
    const d = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 1400) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

test("split a statement into trades, log them, edit one, undo", async ({ page }) => {
  const day = randomWeekday();
  const account = `OBS_SPLIT_${Date.now()}`;
  const zn = DEFAULT_PRODUCTS.find((p) => p.code === "21")!;
  const pdf = await buildAxiaStatementPdf({
    tradeDate: day,
    account,
    products: [MES_THREE_TRADES_PRODUCT, zn],
  });

  await signIn(page, "/statements/upload");
  await page.getByLabel("Statement PDF files").setInputFiles({
    name: "split.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  });
  await expect(page.getByTestId("preview-status")).toContainText("checks passed", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Save statement" }).click();
  await page.getByTestId("build-trades-link").click();
  await expect(page).toHaveURL(/\/statements\/[0-9a-f-]{36}#trades$/);

  const mes = page.locator('[data-testid="build-product"][data-code="MS"]');
  await expect(mes.getByTestId("build-status")).toHaveText("Not split yet");
  await expect(mes.getByRole("radio", { name: "Suggested (3)" })).toBeChecked();
  const drafts = mes.getByTestId("draft-trade");
  await expect(drafts).toHaveCount(3);
  await expect(mes.getByTestId("split-check")).toContainText("−$1.25");

  // Fewer / more trades.
  await mes.getByRole("button", { name: "Fewer trades" }).click();
  await expect(drafts).toHaveCount(2);
  await mes.getByRole("button", { name: "More trades" }).click();
  await expect(drafts).toHaveCount(3);

  // A manual move breaks the balance and blocks creation until undone.
  await drafts.nth(0).getByRole("button", { name: "Buy 2 at 7750" }).click();
  await mes.getByRole("button", { name: "Trade 2", exact: true }).click();
  await expect(drafts).toHaveCount(3);
  await expect(mes.getByTestId("split-check")).toContainText("not flat");
  await expect(mes.getByTestId("create-trades")).toBeDisabled();
  await drafts.nth(1).getByRole("button", { name: "Buy 2 at 7750" }).click();
  await mes.getByRole("button", { name: "Trade 1", exact: true }).click();
  await expect(mes.getByRole("radio", { name: "Your split" })).toBeChecked();

  // Directions (the statement cannot tell), one real time.
  for (const [i, dir] of [
    [1, "Long"],
    [2, "Short"],
    [3, "Long"],
  ] as const) {
    await mes
      .getByRole("radiogroup", { name: `Trade ${i} direction` })
      .getByRole("radio", { name: dir })
      .click();
  }
  await mes.getByLabel("Trade 1 entry time").fill("15:35");
  await mes.getByLabel("Trade 1 exit time").fill("15:50");
  await expect(mes.getByTestId("create-trades")).toBeEnabled();
  const statementUrl = page.url().replace(/#trades$/, "");
  await mes.getByTestId("create-trades").click();
  await expect(page.getByText("3 trades added to the journal")).toBeVisible();
  await expect(mes.getByTestId("build-status")).toContainText("3 trades in the journal");
  const built = mes.getByTestId("built-trades");
  await expect(built.locator("tbody tr")).toHaveCount(3);
  await expect(built.locator("tfoot")).toContainText("−$1.25");

  // ZN: only one split fits (one sell fill).
  const tn = page.locator('[data-testid="build-product"][data-code="21"]');
  await expect(tn.getByText("Only one split fits these fills.")).toBeVisible();
  await tn
    .getByRole("radiogroup", { name: "Trade 1 direction" })
    .getByRole("radio", { name: "Long" })
    .click();
  await tn.getByTestId("create-trades").click();
  await expect(tn.getByTestId("build-status")).toContainText("1 trade in the journal");

  // The reconciliation now matches.
  await page.reload();
  const recon = page.getByTestId("recon-table");
  await expect(recon.locator("tr", { hasText: "MES" })).toHaveAttribute("data-status", "matched");
  await expect(recon.locator("tr", { hasText: "ZN" })).toHaveAttribute("data-status", "matched");

  // Open a built trade whose time is estimated, review it: prices stay exact.
  const { client } = await signedIn(E2E_USER);
  const facts = await client
    .from("trade_facts")
    .select("id, gross_pnl, time_estimated, broker_confirmed, entry_price, symbol")
    .eq("trade_date", day)
    .eq("symbol", "MES")
    .order("entry_at");
  expect(facts.data).toHaveLength(3);
  expect(facts.data!.every((t) => t.broker_confirmed)).toBe(true);
  // The scaled-in long: an average price off the tick grid.
  const estimated = facts.data!.find((t) => Number(t.entry_price) === 7770.125)!;
  expect(estimated.time_estimated).toBe(true);
  expect(Number(estimated.gross_pnl)).toBe(-51.25);
  await page.goto(`/journal/${estimated.id}`);
  await expect(page.getByTestId("time-estimated")).toBeVisible();
  await page.getByRole("radio", { name: /Technical/ }).click();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  const after = await client
    .from("trades")
    .select("gross_pnl, entry_price, needs_review, time_estimated")
    .eq("id", estimated.id)
    .single();
  expect(after.data).toMatchObject({
    gross_pnl: estimated.gross_pnl,
    entry_price: estimated.entry_price,
    needs_review: false,
    time_estimated: true,
  });

  // Journal list: broker badge.
  await page.goto("/journal");
  await expect(page.getByLabel("Broker-confirmed").first()).toBeVisible();

  // Undo the MES build: its trades go to the trash.
  await page.goto(statementUrl);
  const mes2 = page.locator('[data-testid="build-product"][data-code="MS"]');
  await mes2.getByRole("button", { name: "Undo build" }).click();
  await expect(mes2.getByRole("alert")).toContainText("3 journal trades will move to the trash");
  await expect(mes2.getByRole("alert")).toContainText("1 already reviewed");
  await mes2.getByRole("button", { name: "Confirm undo" }).click();
  await expect(mes2.getByTestId("build-status")).toHaveText("Not split yet");
  const gone = await client.from("trades").select("deleted_at").eq("id", estimated.id).single();
  expect(gone.data!.deleted_at).not.toBeNull();
});
