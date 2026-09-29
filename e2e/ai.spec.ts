import { expect, test, type Page } from "./fixtures";

import { E2E_USER, signedIn } from "../tests/local-supabase";
import { signIn } from "./helpers";
import { seedPlaybookTrades } from "./seed";

type QueueItem = {
  request_id: string;
  data_hash: string;
  label: string;
  payload: {
    instructions: string;
    output_schema: unknown;
    baseline: { n: number; expectancy_r: number };
    trades: { id: string }[];
    playbooks: { id: string; name: string }[];
  };
};

async function createAiToken(page: Page) {
  await page.goto("/settings/integrations");
  await page.getByRole("radio", { name: "AI analysis" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("AI analysis routine");
  await page.getByRole("button", { name: "Create token" }).click();
  const input = page.getByTestId("new-token");
  await expect(input).toHaveValue(/^cg_/);
  const token = await input.inputValue();
  await expect(page.getByTestId("token-list")).toContainText("AI analysis");
  return token;
}

test("queue an analysis, the routine posts findings, act on them", async ({ page }) => {
  const name = `AI E2E ${Date.now()}`;
  const { playbookId } = await seedPlaybookTrades(name);
  await signIn(page, "/settings/integrations");
  const token = await createAiToken(page);
  const auth = { Authorization: `Bearer ${token}` };

  // Queue from Insights (filtered to the seeded playbook).
  await page.goto(`/insights?pb=${encodeURIComponent(name)}&tab=ai`);
  await expect(page.getByTestId("ai-setup")).toHaveCount(0);
  await page.getByTestId("ai-queue").click();
  await expect(page.getByTestId("ai-queued")).toContainText("Queued");

  // Tokens are scoped and required.
  expect((await page.request.get("/api/ai/queue")).status()).toBe(401);
  expect(
    (
      await page.request.get("/api/ai/queue", { headers: { Authorization: "Bearer cg_nope" } })
    ).status(),
  ).toBe(401);
  expect((await page.request.get("/api/ai/queue?slot=later", { headers: auth })).status()).toBe(
    400,
  );

  // The routine fetches the queue: a ready payload with rules and schema.
  const res = await page.request.get("/api/ai/queue", { headers: auth });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: QueueItem[] };
  const item = body.items.find((i) => i.label.includes(name));
  expect(item).toBeTruthy();
  expect(item!.payload.baseline).toMatchObject({ n: 12, expectancy_r: 1 });
  expect(item!.payload.instructions).toContain("Use only numbers that appear in the payload");
  expect(item!.payload.trades).toHaveLength(12);
  expect(item!.payload.playbooks.some((p) => p.id === playbookId)).toBe(true);
  const evidence = item!.payload.trades.slice(0, 3).map((t) => t.id);

  const finding = {
    title: "Tuesday longs carry the edge",
    type: "strength",
    observation: "8 Tuesday longs averaged +2.00R; 4 Thursday shorts lost −1.00R each (n=12).",
    evidence_trade_ids: evidence,
    sample_size: 12,
    confidence: "low",
    suggested_experiment:
      "Log the next 10 Tuesday setups and compare with Thursdays before sizing up.",
    related_playbook_id: playbookId,
    domain: "DATA",
  };
  const post = (output: unknown, dataHash = item!.data_hash) =>
    page.request.post("/api/ai/findings", {
      headers: auth,
      data: { request_id: item!.request_id, data_hash: dataHash, model: "claude-e2e", output },
    });

  // Honest-stats rule enforced: small sample must be low confidence.
  const overconfident = await post({
    summary: "One clear pattern, small sample.",
    findings: [{ ...finding, confidence: "high" }],
  });
  expect(overconfident.status()).toBe(422);
  expect(JSON.stringify(await overconfident.json())).toContain("below 20");
  // Evidence must come from the payload.
  const foreign = await post({
    summary: "One clear pattern, small sample.",
    findings: [{ ...finding, evidence_trade_ids: ["00000000-0000-4000-8000-000000000000"] }],
  });
  expect(foreign.status()).toBe(422);

  const ok = await post({
    summary: "One clear pattern, small sample — test it.",
    findings: [finding],
  });
  expect(ok.status()).toBe(200);

  // The finding shows in Insights, up to date with the data.
  await page.reload();
  const insight = page.getByTestId("ai-insight").first();
  await expect(insight).toContainText("Tuesday longs carry the edge");
  await expect(insight).toContainText("low confidence · n=12");
  await expect(page.getByTestId("ai-outdated")).toHaveCount(0);
  await expect(page.getByTestId("ai-queued")).toHaveCount(0);

  await insight.getByRole("button", { name: /3 evidence trades/ }).click();
  await expect(page.getByTestId("drill-list").getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Escape");

  await insight.getByRole("button", { name: "Create action item" }).click();
  await expect(insight.getByRole("button", { name: "Action item added" })).toBeDisabled();
  await insight.getByRole("button", { name: `Add note to ${name}` }).click();
  await expect(insight).toContainText(`Noted in ${name}`);

  const { client } = await signedIn(E2E_USER);
  const pb = await client.from("playbooks").select("notes_md").eq("id", playbookId).single();
  expect(pb.data?.notes_md).toContain("Tuesday longs carry the edge");
  await page.goto("/today");
  await expect(page.getByTestId("action-items")).toContainText("Tuesday longs carry the edge");

  // A weekly review with no trades is marked as not analysable.
  await page.goto("/review/week/2039-W11");
  await page.getByRole("button", { name: /Ask Claude for this week/ }).click();
  await expect(page.getByTestId("weekly-ai").getByTestId("ai-queued")).toBeVisible();
  const again = (await (await page.request.get("/api/ai/queue", { headers: auth })).json()) as {
    items: QueueItem[];
    notes: string[];
  };
  expect(again.items.some((i) => i.label.includes("2039-W11"))).toBe(false);
  expect(again.notes.join(" ")).toContain("No trades in this filter");
  await page.reload();
  await expect(page.getByTestId("weekly-ai").getByTestId("ai-queued")).toHaveCount(0);
});
