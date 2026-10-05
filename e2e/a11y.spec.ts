import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

import { signIn } from "./helpers";
import { seedStatementPage } from "./seed-statement";

/**
 * Automated accessibility scan (axe, WCAG 2.1 A/AA) of every main page in
 * both themes. Serious and critical violations fail the test; the rest are
 * printed so they can be reviewed.
 */
const PAGES = [
  "/today",
  "/journal",
  "/journal/new",
  "/calendar",
  "/prep",
  "/review",
  "/review/today",
  "/review/today?full=1",
  "/insights",
  "/playbook",
  "/statements",
  "/statements/upload",
  "/settings",
  "/settings/instruments",
  "/settings/tags",
  "/settings/rules",
  "/settings/statements",
  "/settings/integrations",
  "/settings/data",
  "/settings/import",
  "/settings/calendar",
  "/settings/routine",
];

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations.map((v) => ({
    path,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes
      .slice(0, 6)
      .map((n) => `${n.target.join(" ")} :: ${(n.any[0]?.message ?? "").slice(0, 140)}`),
  }));
}

for (const theme of ["dark", "light"] as const) {
  test(`no serious accessibility violations (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    const statementPage = await seedStatementPage();
    await signIn(page, "/today");
    await page.evaluate((t) => localStorage.setItem("theme", t), theme);
    const all = [];
    for (const path of [...PAGES, statementPage]) all.push(...(await scan(page, path)));
    if (all.length) console.log(JSON.stringify(all, null, 1));
    const blocking = all.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking).toEqual([]);
  });
}
