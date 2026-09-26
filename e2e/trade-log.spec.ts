import { closeSync, openSync, ftruncateSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { fillQuickTrade, pasteImage, signIn, status } from "./helpers";

test("log a trade with a pasted screenshot; autosave survives reload", async ({ page }) => {
  await signIn(page, "/journal/new");
  await expect(status(page)).toHaveText(/Not saved yet/);

  await fillQuickTrade(page);
  await expect(page.getByTestId("live-preview")).toContainText("+$200.00");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

  await pasteImage(page);
  await expect(page.getByTestId("media-item")).toHaveCount(1, { timeout: 15_000 });

  // Details: thesis autosaves too.
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByLabel("Thesis (why)").fill("First test of beginning zone after CPI liquidation");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel("Entry price *")).toHaveValue("5000.00");
  await expect(page.getByLabel("Exit price *")).toHaveValue("5004.00");
  await expect(page.getByTestId("media-item")).toHaveCount(1);
  await page.getByRole("button", { name: "More details" }).click();
  await expect(page.getByLabel("Thesis (why)")).toHaveValue(/beginning zone/);
});

test("an incomplete draft is kept on the device and can be restored", async ({ page }) => {
  await signIn(page, "/journal/new");
  await page.getByLabel("Entry price *").fill("4321.25");
  await expect(status(page)).toHaveAttribute("data-status", "blocked");
  await expect(status(page)).toContainText("direction");

  await page.goto("/journal/new");
  await expect(page.getByRole("alert").filter({ hasText: "unsaved trade" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByLabel("Entry price *")).toHaveValue("4321.25");

  // Completing it saves it.
  await page.getByRole("radio", { name: /Short/ }).click();
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
});

test("offline edits show an error, then save by themselves when back online", async ({
  page,
  context,
}) => {
  await signIn(page, "/journal/new");
  await fillQuickTrade(page, "5100", "5101");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  await context.setOffline(true);
  await page.getByLabel("Exit price *").fill("5102");
  await expect(status(page)).toHaveAttribute("data-status", "error", { timeout: 10_000 });
  await context.setOffline(false);
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

  await page.reload();
  await expect(page.getByLabel("Exit price *")).toHaveValue("5102.00");
});

test("videos over 50 MB are refused with a link suggestion", async ({ page }) => {
  await signIn(page, "/journal/new");
  // Sparse 51 MB file on disk (Playwright refuses in-memory buffers > 50 MB).
  const path = test.info().outputPath("long-session.mp4");
  const fd = openSync(path, "w");
  ftruncateSync(fd, 51 * 1024 * 1024);
  closeSync(fd);
  await page.getByTestId("media-file-input").setInputFiles(path);
  await expect(page.getByText(/limit is 50 MB/)).toBeVisible();
  await expect(page.getByTestId("media-queued")).toHaveCount(0);
});

test("missed and observed kinds", async ({ page }) => {
  await signIn(page, "/journal/new");
  await page.getByRole("radio", { name: "Missed" }).click();
  await fillQuickTrade(page, "5000", "5010");
  await expect(page.getByTestId("live-preview")).toContainText("Left on table");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });

  await page.goto("/journal/new");
  await page.getByRole("radio", { name: "Observed" }).click();
  await expect(page.getByLabel("Contracts *")).toHaveCount(0);
  await page.getByRole("radio", { name: "ES", exact: true }).click();
  await page.getByRole("radio", { name: /Up/ }).click();
  await page.getByLabel("Start price *").fill("5000");
  await page.getByLabel("End price *").fill("5030");
  await page.getByRole("radio", { name: /Data/ }).click();
  await expect(page.getByTestId("live-preview")).toContainText("+120t");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
});

test("videos upload resumably (TUS) with progress and appear in the gallery", async ({ page }) => {
  await signIn(page, "/journal/new");
  await fillQuickTrade(page, "5200", "5201");
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await page.getByTestId("media-file-input").setInputFiles({
    name: "entry.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(7 * 1024 * 1024, 1), // > one 6 MB TUS chunk
  });
  await expect(page.getByTestId("media-item")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("media-queued")).toHaveCount(0);
});
