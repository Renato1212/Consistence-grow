import { expect, type Page } from "@playwright/test";

import { E2E_USER } from "../tests/local-supabase";

export async function signIn(page: Page, next = "/today") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByRole("textbox", { name: "Password" }).fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}
