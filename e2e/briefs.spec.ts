import { expect, test, type Page } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";

import { signIn, status } from "./helpers";

const brief = (tag: string) => `# Pre-Session Brief — European-open edition

## 0. TL;DR
- **Regime:** ${tag}
- Key events: CPI 13:30 Lisbon
- Main risk: hot print

## 1. Overnight & recent moves
- ES +0.3%

Context only — confirm with the auction.`;

function randomWeekday(): string {
  for (;;) {
    const d = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

async function createToken(page: Page) {
  await page.goto("/settings/integrations");
  await page.getByLabel("Name").fill(`e2e ${Date.now()}`);
  await page.getByRole("button", { name: "Create token" }).click();
  const input = page.getByTestId("new-token");
  await expect(input).toHaveValue(/^cg_/);
  return input.inputValue();
}

test("a delivered brief fills the prep, offers replace, shows on Today; bad tokens are refused", async ({
  page,
}) => {
  await signIn(page);
  const token = await createToken(page);
  const date = randomWeekday();
  const send = (markdown: string, over: Record<string, unknown> = {}, auth = token) =>
    page.request.post("/api/ingest/brief", {
      headers: { Authorization: `Bearer ${auth}` },
      data: { edition: "eu", date, markdown, ...over },
    });

  const first = await send(brief("risk-on drift"));
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, date, session: "EU" });

  // Empty prep → filled automatically and rendered.
  await page.goto(`/prep/${date}/eu`);
  await expect(page.getByTestId("brief-rendered")).toContainText("risk-on drift");

  // My own text is never overwritten: a newer brief is offered instead.
  await page.getByRole("radio", { name: "Paste" }).click();
  await page.getByLabel("Pre-session brief (markdown)").fill("My own notes");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  expect((await send(brief("risk-off after tariffs"))).status()).toBe(200);
  await page.reload();
  const offer = page.getByTestId("brief-offer");
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Replace" }).click();
  await expect(offer).toHaveCount(0);
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("brief-rendered")).toContainText("risk-off after tariffs");

  // Today shows the TL;DR of today's brief.
  const today = formatInTimeZone(new Date(), "Europe/Lisbon", "yyyy-MM-dd");
  expect((await send(brief("today's regime"), { date: today })).status()).toBe(200);
  await page.goto("/today");
  await expect(page.getByTestId("brief-card")).toContainText("today's regime");

  // Refusals.
  expect((await send("x", {}, "cg_wrong")).status()).toBe(401);
  expect((await send("x", { edition: "asia" })).status()).toBe(400);
  const noAuth = await page.request.post("/api/ingest/brief", {
    data: { edition: "eu", markdown: "x" },
  });
  expect(noAuth.status()).toBe(401);

  // Revoke → refused.
  await page.goto("/settings/integrations");
  page.once("dialog", (d) => void d.accept());
  await page
    .getByTestId("token-list")
    .getByRole("listitem")
    .last()
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("Token revoked")).toBeVisible();
  expect((await send(brief("late"))).status()).toBe(401);
});
