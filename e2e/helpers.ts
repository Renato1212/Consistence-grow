import { expect, type Page } from "@playwright/test";

import { E2E_USER } from "../tests/local-supabase";

export async function signIn(page: Page, next = "/today") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  // The tab only works once the page has hydrated: retry until it switches.
  const passwordBox = page.getByRole("textbox", { name: "Password" });
  await expect(async () => {
    await page.getByRole("tab", { name: "Password" }).click();
    await expect(passwordBox).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByRole("textbox", { name: "Password" }).fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const escaped = next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page).toHaveURL(new RegExp(`${escaped}$`));
}

export async function pasteImage(page: Page, name = "chart.png") {
  await page.evaluate(async (fileName) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f28c28";
    ctx.fillRect(0, 0, 800, 450);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], fileName, { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, name);
}

export const status = (page: Page) => page.getByTestId("save-status");

export async function fillQuickTrade(page: Page, entry = "5000", exit = "5004") {
  await page.getByRole("radio", { name: "ES", exact: true }).click();
  await page.getByRole("radio", { name: /Long/ }).click();
  await page.getByLabel("Entry price *").fill(entry);
  await page.getByLabel("Exit price *").fill(exit);
  await page.getByRole("radio", { name: /Technical/ }).click();
}

/** Log a complete ES trade and return its id. */
export async function logTrade(
  page: Page,
  opts: { entry?: string; exit?: string; thesis?: string } = {},
) {
  await page.goto("/journal/new");
  await fillQuickTrade(page, opts.entry, opts.exit);
  if (opts.thesis) {
    await page.getByRole("button", { name: "More details" }).click();
    await page.getByLabel("Thesis (why)").fill(opts.thesis);
  }
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 10_000 });
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}
