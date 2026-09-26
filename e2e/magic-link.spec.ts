import { expect, test } from "@playwright/test";

import { E2E_USER } from "../tests/local-supabase";

// Local Supabase routes all auth email to Mailpit.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitList = { messages: { ID: string; To: { Address: string }[]; Created: string }[] };

async function latestLinkFor(email: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as MailpitList;
    const msg = list.messages.find(
      (m) => m.To.some((t) => t.Address === email) && Date.parse(m.Created) >= since,
    );
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
        HTML: string;
        Text: string;
      };
      const match =
        (full.HTML || full.Text).match(/href="([^"]+)"/) ??
        (full.Text || "").match(/(https?:\/\/\S+verify\S+)/);
      if (match) return match[1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link email for ${email}`);
}

test("magic link signs me in and lands on the requested page", async ({ page }) => {
  const since = Date.now() - 1000;
  await page.goto("/login?next=%2Freview");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  const link = await latestLinkFor(E2E_USER.email, since);
  await page.goto(link);
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
});

test("an invalid link shows a clear error", async ({ page }) => {
  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(page.getByText(/invalid or expired/)).toBeVisible();
});
