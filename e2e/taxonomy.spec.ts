import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

test("tags: add, rename, archive, merge with undo; rules: add, deactivate, delete with undo", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await signIn(page, "/settings/tags");
  const manager = page.getByTestId("tag-manager");

  // A new group with two tags.
  await manager.getByPlaceholder("e.g. Market structure").fill(`Group ${stamp}`);
  await manager.getByRole("button", { name: "Add group" }).click();
  const group = page.getByRole("region", { name: `Group Group ${stamp}` });
  await expect(group).toBeVisible();
  for (const name of [`alpha ${stamp}`, `beta ${stamp}`]) {
    await group.getByLabel(`New tag in Group ${stamp}`).fill(name);
    await group.getByRole("button", { name: "Add", exact: true }).click();
    await expect(group.locator(`li[data-tag="${name}"]`)).toBeVisible();
  }

  // Rename.
  const alpha = group.locator(`li[data-tag="alpha ${stamp}"]`);
  await alpha.getByLabel(`Tag name alpha ${stamp}`).fill(`alpha2 ${stamp}`);
  await alpha.getByLabel(`Tag name alpha ${stamp}`).press("Enter");
  await expect(group.locator(`li[data-tag="alpha2 ${stamp}"]`)).toBeVisible();

  // Archive and unarchive.
  const alpha2 = group.locator(`li[data-tag="alpha2 ${stamp}"]`);
  await alpha2.getByRole("button", { name: `Archive tag alpha2 ${stamp}` }).click();
  await expect(alpha2.getByText("archived")).toBeVisible();
  await alpha2.getByRole("button", { name: `Unarchive tag alpha2 ${stamp}` }).click();
  await expect(alpha2.getByText("archived")).toHaveCount(0);

  // Merge beta into alpha2, then undo.
  const beta = group.locator(`li[data-tag="beta ${stamp}"]`);
  await beta
    .getByLabel(`Merge tag beta ${stamp} into`)
    .selectOption({ label: `Group ${stamp} · alpha2 ${stamp}` });
  await beta.getByRole("button", { name: "Merge" }).click();
  await beta.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText(`“beta ${stamp}” merged into “alpha2 ${stamp}”`)).toBeVisible();
  await expect(group.locator(`li[data-tag="beta ${stamp}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(group.locator(`li[data-tag="beta ${stamp}"]`)).toBeVisible();

  // Rules.
  await page.goto("/settings/rules");
  const rules = page.getByTestId("rule-manager");
  const text = `No revenge trades ${stamp}`;
  await rules.getByPlaceholder("e.g. No new trades after two losses in a row.").fill(text);
  await rules.getByRole("button", { name: "Add rule" }).click();
  const row = rules.locator(`li[data-rule="${text}"]`);
  await expect(row).toBeVisible();
  await row.getByLabel(`Ask rule “${text}” in prep and debrief`).uncheck();
  await expect(row.getByLabel(`Ask rule “${text}” in prep and debrief`)).not.toBeChecked();
  await row.getByRole("button", { name: `Delete rule “${text}”` }).click();
  await expect(rules.locator(`li[data-rule="${text}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rules.locator(`li[data-rule="${text}"]`)).toBeVisible();
});
