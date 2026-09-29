import { expect, test, type Page } from "./fixtures";

import { fillQuickTrade, signIn, status } from "./helpers";

async function saved(page: Page) {
  await expect(status(page).first()).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
}

test("create a playbook, edit it into v2 with a diff, trade it with the checklist, see stats", async ({
  page,
}) => {
  const name = `CPI fade ${Date.now()}`;
  await signIn(page, "/playbook");
  await page.getByRole("link", { name: "New Data playbook" }).first().click();
  await expect(page).toHaveURL(/\/playbook\/new\?domain=DATA$/);

  await page.getByLabel("Name *").fill(name);
  await page.getByLabel("Edge", { exact: true }).fill("Algos overshoot the first print.");
  await page.getByRole("button", { name: "Add checklist item" }).click();
  await page.getByLabel("Checklist item 1").fill("Waited for the first 5-min candle?");
  await page.getByRole("button", { name: "Add checklist item" }).click();
  await page.getByLabel("Checklist item 2").fill("Stop beyond the spike?");
  await saved(page);
  await expect(page).toHaveURL(/\/playbook\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("playbook-version")).toHaveText("v1");
  const url = page.url();

  // Same editing session: still v1.
  await page.getByRole("radio", { name: "Testing" }).click();
  await saved(page);
  await expect(page.getByTestId("playbook-version")).toHaveText("v1");

  // New session: a structured change creates v2.
  await page.goto(url);
  await expect(page.getByTestId("playbook-read")).toContainText("Algos overshoot the first print.");
  await page.getByRole("radio", { name: "Edit" }).click();
  await page
    .getByLabel("Edge", { exact: true })
    .fill("Algos overshoot the first print.\nFade the retest.");
  await saved(page);
  await expect(page.getByTestId("playbook-version")).toHaveText("v2");

  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByTestId("version-row")).toHaveCount(2);
  const diff = page.getByTestId("version-diff");
  await expect(diff).toContainText("Edge");
  await expect(diff).toContainText("+ Fade the retest.");
  // The status change happened in the first session, so it is part of v1, not the diff.
  await expect(diff).not.toContainText("Status");

  // Log a trade on it and tick one checklist item.
  await page.goto("/journal/new");
  await fillQuickTrade(page, "5000", "5002");
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByLabel("Stop", { exact: true }).fill("4998");
  await page.getByLabel("Playbook").selectOption({ label: name });
  const checklist = page.getByTestId("trade-checklist");
  await expect(checklist).toContainText("0/2");
  await checklist.getByRole("checkbox").first().check();
  await expect(checklist).toContainText("1/2");
  await saved(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("checklist-badge")).toHaveText("Checklist 1/2");

  // Stats and the landing card.
  await page.goto(url);
  await page.getByRole("tab", { name: /Stats/ }).click();
  const stats = page.getByTestId("playbook-stats");
  await expect(stats).toContainText("Trades");
  await expect(page.getByTestId("checklist-adherence")).toContainText("0/1 trades fully ticked");
  await page.goto("/playbook");
  const card = page.getByTestId("playbook-card").filter({ hasText: name });
  await expect(card).toContainText("v2");
  await expect(card).toContainText("Last traded");
});

test("delete a playbook, undo from the list, restore", async ({ page }) => {
  const name = `Throwaway ${Date.now()}`;
  await signIn(page, "/playbook/new?domain=FLOW");
  await page.getByLabel("Name *").fill(name);
  await saved(page);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/playbook$/);
  await expect(page.getByTestId("playbook-card").filter({ hasText: name })).toHaveCount(0);
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("playbook-card").filter({ hasText: name })).toHaveCount(1);
});
