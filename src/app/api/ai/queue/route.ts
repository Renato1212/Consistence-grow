import { NextResponse, type NextRequest } from "next/server";

import { buildPayload, type AiContext } from "@/lib/ai/payload";
import { AI_SLOTS, slotRequest, type AiSlot, type RequestSpec } from "@/lib/ai/requests";
import { bearer, fail, rpcFailure, tokenClient } from "@/lib/ai/server";
import { HolidayCalendar } from "@/lib/calendar/holidays";
import { normalizeFilter } from "@/lib/insights/filters";
import { lisbonToday } from "@/lib/time";

/**
 * GET /api/ai/queue[?slot=eu|us|weekly] — for the analysis routine.
 *
 *   Authorization: Bearer cg_…   (token with the "ai" scope)
 *
 * With a slot, first queues that scheduled analysis (pre-EU / pre-US session,
 * weekly review) unless it would repeat one already done on the same data.
 * Returns every open request with a ready payload (instructions + output
 * schema inside). Post each result to /api/ai/findings. Empty `items` = done.
 */
export const dynamic = "force-dynamic";

const MAX_ITEMS = 5;

export async function GET(req: NextRequest) {
  const token = bearer(req);
  if (!token) return fail(401, "Missing bearer token");
  const slotParam = req.nextUrl.searchParams.get("slot");
  if (slotParam && !(AI_SLOTS as string[]).includes(slotParam)) {
    return fail(400, 'slot must be "eu", "us" or "weekly"');
  }
  const slot = slotParam as AiSlot | null;

  const supabase = tokenClient();
  const res = await supabase.rpc("ai_context", { p_token: token });
  if (res.error) return rpcFailure(res.error, "context");
  const ctx = res.data as unknown as AiContext;
  const statements = await supabase.rpc("ai_statements", { p_token: token });
  // Statements only enrich the weekly analysis; never block the queue on them.
  ctx.statements = statements.error ? [] : (statements.data as unknown as AiContext["statements"]);
  const today = lisbonToday();
  const notes: string[] = [];

  if (slot) {
    const cal = new HolidayCalendar(
      ctx.holidays.map((h) => ({
        date: h.date,
        market: h.market,
        name: h.name,
        earlyClose: h.early_close,
      })),
    );
    const spec = slotRequest(slot, today, cal);
    if ("skip" in spec) {
      notes.push(`${slot}: skipped (${spec.skip})`);
    } else {
      const built = buildPayload(ctx, spec, today, null);
      if (built.empty) notes.push(`${slot}: skipped (${built.reason})`);
      else if (ctx.recent_hashes.includes(built.dataHash))
        notes.push(`${slot}: skipped (already analysed on the same data)`);
      else {
        const q = await supabase.rpc("ai_enqueue", {
          p_token: token,
          p_kind: spec.kind,
          p_slot: spec.slot ?? slot,
          p_label: spec.label,
          p_filter: spec.filter as never,
          p_filter_key: spec.filterKey,
          p_week: spec.week ?? undefined,
        });
        if (q.error) return rpcFailure(q.error, "enqueue");
        if (!ctx.requests.some((r) => r.id === q.data)) {
          ctx.requests.push({
            id: q.data as string,
            kind: spec.kind,
            slot: spec.slot,
            label: spec.label,
            filter: spec.filter,
            filter_key: spec.filterKey,
            week: spec.week,
            status: "pending",
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  const items = [];
  for (const r of ctx.requests) {
    if (items.length >= MAX_ITEMS) {
      notes.push("more requests waiting — call again after posting these");
      break;
    }
    const spec: RequestSpec = {
      kind: r.kind,
      slot: r.slot,
      label: r.label,
      filter: normalizeFilter(r.filter),
      filterKey: r.filter_key,
      week: r.week,
    };
    const built = buildPayload(ctx, spec, today, r.id);
    if (built.empty) {
      await supabase.rpc("ai_fail", { p_token: token, p_request: r.id, p_error: built.reason });
      notes.push(`${r.label}: ${built.reason}`);
      continue;
    }
    const served = await supabase.rpc("ai_serve", {
      p_token: token,
      p_request: r.id,
      p_data_hash: built.dataHash,
      p_trade_ids: built.tradeIds,
      p_playbook_ids: built.playbookIds,
    });
    if (served.error) {
      if (served.error.code === "P0002") continue;
      return rpcFailure(served.error, "serve");
    }
    items.push({
      request_id: r.id,
      data_hash: built.dataHash,
      label: r.label,
      payload: built.payload,
    });
  }

  return NextResponse.json({
    ok: true,
    today,
    items,
    notes,
    post_to: "/api/ai/findings",
    post_body: '{ "request_id", "data_hash", "model", "output": <matches payload.output_schema> }',
  });
}
