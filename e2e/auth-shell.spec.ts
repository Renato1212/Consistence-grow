import { expect, test } from "./fixtures";

import { signIn } from "./helpers";

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  await expect(page.getByRole("heading", { name: "Consistent Grow" })).toBeVisible();
});

test("wrong password shows a calm, generic error", async ({ page }) => {
  await page.goto("/login");
  await expect(async () => {
    await page.getByRole("tab", { name: "Password" }).click();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel("Email").fill("e2e@consistent-grow.test");
  await page.getByRole("textbox", { name: "Password" }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Sign-in failed/)).toBeVisible();
});

test("sign in, navigate with shortcuts and palette, sign out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  // G then J → Journal
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();

  // N → log trade
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/journal\/new$/);

  // ⌘K palette → Playbook
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Go to…").fill("Playbook");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/playbook$/);
  await expect(page.getByText("First test of beginning zone")).toBeVisible();

  // Deep link survives login redirect and session persists across reloads.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Playbook", exact: true })).toBeVisible();

  // Sign out from Settings.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/login\?next=%2Fjournal$/);
});

test("login respects the next parameter", async ({ page }) => {
  await signIn(page, "/insights");
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
});
