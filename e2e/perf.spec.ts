import { expect, test } from "./fixtures";

import { prepareStatement } from "../src/lib/statements/payload";
import { DEFAULT_PRODUCTS, buildAxiaStatementPdf } from "../tests/fixtures/axia-statement";
import { signedIn } from "../tests/local-supabase";
import { signIn } from "./helpers";

/**
 * Performance check with a year and a half of generated data for a separate
 * local user (never production): 5,000 trades with tags, 250 statements.
 * Opt-in: `PERF=1 pnpm e2e e2e/perf.spec.ts`. Prints server time per page and
 * fails when a page takes longer than the budget.
 */
const PERF_USER = { email: "perf@consistent-grow.test", password: "perf-password-not-secret" };
const TRADES = 5000;
const STATEMENTS = 250;
const BUDGET_MS = 3000;

test.skip(!process.env.PERF, "set PERF=1 to run the performance check");
test.setTimeout(20 * 60_000);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function weekdays(count: number, start = Date.UTC(2025, 0, 6)): string[] {
  const out: string[] = [];
  for (let t = start; out.length < count; t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function seed() {
  const { client } = await signedIn(PERF_USER);
  const have = await client
    .from("trades")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  const inst = await client
    .from("instruments")
    .select("id, symbol, tick_size")
    .is("deleted_at", null);
  const tags = await client.from("tags").select("id").is("deleted_at", null);
  const bySymbol = new Map((inst.data ?? []).map((i) => [i.symbol, i]));
  const symbols = ["ES", "MES", "NQ", "CL", "ZN", "6E"];
  const base: Record<string, number> = {
    ES: 5000,
    MES: 5000,
    NQ: 18000,
    CL: 75,
    ZN: 110,
    "6E": 1.08,
  };
  const domains = ["TECHNICAL", "DATA", "NEWS", "CENTRAL_BANKS", "FLOW"];
  const rand = rng(7);
  const days = weekdays(400);

  if ((have.count ?? 0) < TRADES) {
    for (let batch = 0; batch < TRADES / 500; batch++) {
      const rows = Array.from({ length: 500 }, () => {
        const sym = symbols[Math.floor(rand() * symbols.length)];
        const i = bySymbol.get(sym)!;
        const tick = Number(i.tick_size);
        const day = days[Math.floor(rand() * days.length)];
        const minute = 7 * 60 + Math.floor(rand() * 12 * 60);
        const entryAt = new Date(`${day}T00:00:00Z`).getTime() + minute * 60_000;
        const long = rand() < 0.5;
        const entry = base[sym];
        const risk = 8 * tick;
        const move = Math.round((rand() * 3 - 1.1) * 8) * tick;
        return {
          instrument_id: i.id,
          direction: long ? "long" : "short",
          entry_at: new Date(entryAt).toISOString(),
          exit_at: new Date(entryAt + (5 + Math.floor(rand() * 60)) * 60_000).toISOString(),
          entry_price: entry,
          exit_price: long ? entry + move : entry - move,
          stop_price: long ? entry - risk : entry + risk,
          contracts: 1 + Math.floor(rand() * 3),
          fees: 0,
          primary_domain: domains[Math.floor(rand() * domains.length)],
          confidence: 1 + Math.floor(rand() * 5),
          grade_process: ["A", "B", "C", "F"][Math.floor(rand() * 4)],
        };
      });
      const ins = await client.from("trades").insert(rows).select("id");
      if (ins.error) throw ins.error;
      const links = (ins.data ?? []).flatMap((t) =>
        (tags.data ?? [])
          .filter(() => rand() < 0.08)
          .slice(0, 3)
          .map((tag) => ({ trade_id: t.id, tag_id: tag.id })),
      );
      if (links.length) {
        const tt = await client.from("trade_tags").insert(links);
        if (tt.error) throw tt.error;
      }
    }
  }

  const st = await client
    .from("statements")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if ((st.count ?? 0) < STATEMENTS) {
    let cash = 50_000;
    for (const day of days.slice(0, STATEMENTS)) {
      const bytes = await buildAxiaStatementPdf({
        tradeDate: day,
        account: "OBS_PERF",
        openCash: cash,
        products: DEFAULT_PRODUCTS,
      });
      const { payload } = await prepareStatement(bytes);
      const r = await client.rpc("save_statement", { p_statement: payload });
      if (r.error) throw r.error;
      cash = payload.close_cash ?? cash;
    }
  }
}

test("pages stay fast with 5,000 trades and 250 statements", async ({ page }) => {
  await seed();
  await signIn(page, "/today", PERF_USER);
  const pages = [
    "/today",
    "/journal",
    "/insights",
    "/insights?tab=breakdowns",
    "/insights?tab=patterns",
    "/insights?tab=broker",
    "/statements",
    "/playbook",
    "/review",
    "/calendar",
    "/settings/statements",
  ];
  const timings: [string, number][] = [];
  const server: number[] = [];
  for (const path of pages) {
    // Warm once (compilation/caches), then measure the second load.
    await page.goto(path);
    const s0 = Date.now();
    await page.request.get(path);
    server.push(Date.now() - s0);
    const t0 = Date.now();
    const res = await page.goto(path, { waitUntil: "load" });
    const ms = Date.now() - t0;
    expect(res?.status(), path).toBe(200);
    timings.push([path, ms]);
  }
  console.log(
    timings.map(([p, ms], i) => `${p.padEnd(28)} ${ms} ms (server ${server[i]} ms)`).join("\n"),
  );
  for (const [path, ms] of timings) expect(ms, path).toBeLessThan(BUDGET_MS);
});
