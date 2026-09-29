import { expect, test, type Page } from "./fixtures";

import { generateToken, hashToken, tokenPrefix } from "../src/lib/briefs/token";
import { DEFAULT_PRODUCTS, buildAxiaStatementPdf } from "../tests/fixtures/axia-statement";
import { E2E_USER, signedIn } from "../tests/local-supabase";
import { signIn } from "./helpers";

function randomWeekday(offsetDays = 0): string {
  for (;;) {
    const d = new Date(
      Date.UTC(2030, 0, 1) + (Math.floor(Math.random() * 1400) + offsetDays) * 86_400_000,
    );
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

async function choose(page: Page, files: { name: string; bytes: Uint8Array }[]) {
  await page.getByLabel("Statement PDF files").setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: "application/pdf",
      buffer: Buffer.from(f.bytes),
    })),
  );
}

/** A journal MES long that matches the fixture's MES product (−$200 gross). */
async function seedMatchingTrade(date: string) {
  const { client } = await signedIn(E2E_USER);
  const mes = await client
    .from("instruments")
    .select("id")
    .eq("symbol", "MES")
    .is("deleted_at", null)
    .single();
  if (mes.error) throw mes.error;
  const r = await client.from("trades").insert({
    instrument_id: mes.data.id,
    direction: "long",
    contracts: 10,
    fees: 0,
    entry_at: `${date}T14:00:00Z`,
    exit_at: `${date}T14:20:00Z`,
    entry_price: 7760.25,
    exit_price: 7756.25,
    primary_domain: "TECHNICAL",
  });
  if (r.error) throw r.error;
}

test("upload statements, check, save, reconcile, replace, map and deliver by token", async ({
  page,
}) => {
  const account = `OBS_E2E_${Date.now()}`;
  const day = randomWeekday();
  const other = randomWeekday(1500);
  const good = await buildAxiaStatementPdf({ tradeDate: day, account, products: DEFAULT_PRODUCTS });
  const broken = await buildAxiaStatementPdf({
    tradeDate: other,
    account,
    products: DEFAULT_PRODUCTS,
    tamper: { summaryRealized: 1234.56 },
  });
  await seedMatchingTrade(day);

  await signIn(page, "/statements/upload");
  await choose(page, [
    { name: "good.pdf", bytes: good },
    { name: "broken.pdf", bytes: broken },
  ]);
  const previews = page.getByTestId("statement-preview");
  await expect(previews).toHaveCount(2);
  const goodCard = previews.filter({ hasText: "good.pdf" });
  const brokenCard = previews.filter({ hasText: "broken.pdf" });
  await expect(goodCard.getByTestId("preview-status")).toContainText("checks passed", {
    timeout: 20_000,
  });
  await expect(brokenCard.getByTestId("preview-status")).toContainText("Needs attention", {
    timeout: 20_000,
  });
  await expect(brokenCard.getByTestId("preview-issues")).toContainText(
    "Realized P/L matches the financial summary",
  );
  // Products land on the right instruments (MES, ZN, MCL, 6J) with no guesses.
  for (const sym of ["ZN", "MES", "MCL", "6J"])
    await expect(goodCard.getByRole("list", { name: "Products" })).toContainText(sym);

  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("preview-saved")).toHaveCount(2);

  // Same file again → already imported; a corrected file for the day → replace.
  await page.reload();
  await choose(page, [{ name: "good-again.pdf", bytes: good }]);
  await expect(page.getByTestId("preview-duplicate")).toBeVisible({ timeout: 20_000 });
  const corrected = await buildAxiaStatementPdf({
    tradeDate: day,
    account,
    openCash: 30_000,
    products: DEFAULT_PRODUCTS,
  });
  await choose(page, [{ name: "corrected.pdf", bytes: corrected }]);
  const conflict = page.getByTestId("preview-conflict");
  await expect(conflict).toContainText("Close cash", { timeout: 20_000 });
  await conflict.getByRole("button", { name: "Replace" }).click();
  await expect(page.getByTestId("preview-saved").first()).toContainText("Replaced");

  // Dashboard for this account.
  await page.goto(`/statements?account=${account}`);
  await expect(page.getByTestId("statements-kpis")).toContainText("n=2 days");
  await expect(page.getByTestId("statements-warnings")).toContainText("did not pass every check");
  const products = page.getByTestId("statements-products");
  for (const sym of ["ZN", "MES", "MCL", "6J"]) await expect(products).toContainText(sym);
  await expect(products).not.toContainText("check mapping");
  await page.getByRole("button", { name: /Show all/ }).click();
  const mesRow = page
    .getByTestId("recon-table")
    .locator("tr", { hasText: day })
    .filter({ hasText: "MES" });
  await expect(mesRow).toHaveAttribute("data-status", "matched");
  await expect(
    page.getByTestId("recon-table").locator("tr", { hasText: day }).filter({ hasText: "ZN" }),
  ).toHaveAttribute("data-status", "missing");

  // Day view.
  await page.getByTestId("statements-list").getByRole("link", { name: day }).click();
  await expect(page).toHaveURL(/\/statements\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("statement-status")).toContainText("All checks passed");
  await expect(page.getByTestId("statement-products")).toContainText("MICR CRUDE");
  await expect(page.getByTestId("statement-summary")).toContainText("30,");

  // The debrief shows the broker-confirmed P/L of the day.
  await page.goto(`/review/${day}`);
  await expect(page.getByTestId("broker-card")).toContainText("Broker-confirmed P/L");

  // Settings: every code mapped and size-verified.
  await page.goto("/settings/statements");
  for (const code of ["21", "MS", "EF", "J1"]) {
    await expect(page.locator(`tr[data-code="${code}"]`)).toContainText("size verified");
  }

  // Token delivery: no/invalid token → 401; a statements token → the same file is a no-op.
  const unauth = await page.request.post("/api/ingest/statement", {
    headers: { "Content-Type": "application/pdf" },
    data: Buffer.from(corrected),
  });
  expect(unauth.status()).toBe(401);
  const token = generateToken();
  const { client } = await signedIn(E2E_USER);
  const ins = await client.from("api_tokens").insert({
    name: "e2e statements",
    token_hash: await hashToken(token),
    prefix: tokenPrefix(token),
    scopes: ["statements"],
  });
  expect(ins.error).toBeNull();
  const notPdf = await page.request.post("/api/ingest/statement", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
    data: Buffer.from("hello"),
  });
  expect(notPdf.status()).toBe(415);
  const again = await page.request.post("/api/ingest/statement", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
    data: Buffer.from(corrected),
  });
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ ok: true, status: "duplicate", checks: "ok" });
  const bad = await page.request.post("/api/ingest/statement", {
    headers: { Authorization: "Bearer cg_wrong", "Content-Type": "application/pdf" },
    data: Buffer.from(corrected),
  });
  expect(bad.status()).toBe(401);
});
