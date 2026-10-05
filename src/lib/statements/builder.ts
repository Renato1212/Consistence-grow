/**
 * Draft model of the statement trade builder: trades as fill allocations the
 * owner can move between, plus the RPC payload and the local draft copy.
 * Pure (unit-tested); the UI is src/components/statements/trade-builder.tsx.
 */
import { localInputToIso } from "@/lib/trading/trade-form";

import type { Allocation, Direction, Group, SplitFill } from "./split";

export type DraftTrade = {
  key: string;
  allocations: Allocation[];
  direction: Direction | null;
  /** "HH:MM" (display zone) or "" when not known. */
  entry: string;
  exit: string;
  /** Journal trade this group links to (instead of creating one). */
  linkTradeId: string | null;
  /** Setup (playbook) of the trade, one tap in the builder. */
  playbookId: string | null;
};

let counter = 0;
export const newKey = () => `t${Date.now().toString(36)}${(++counter).toString(36)}`;

export function draftsFromGroups(
  groups: Group[],
  extra: (i: number) => Partial<DraftTrade> = () => ({}),
): DraftTrade[] {
  return groups.map((g, i) => ({
    key: newKey(),
    allocations: g.map((a) => ({ ...a })),
    direction: null,
    entry: "",
    exit: "",
    linkTradeId: null,
    playbookId: null,
    ...extra(i),
  }));
}

/**
 * Move `qty` of a fill from one trade to another. `from`/`to` are trade keys;
 * null = not in a trade; "new" (to only) = a new trade at the end. Empty
 * trades are removed. A move that changes a trade's fills drops its journal
 * link (it no longer matches that trade).
 */
export function moveFill(
  drafts: DraftTrade[],
  fillId: string,
  from: string | null,
  to: string | null | "new",
  qty: number,
): DraftTrade[] {
  if (qty <= 0 || from === to) return drafts;
  let out = drafts.map((d) => ({ ...d, allocations: [...d.allocations] }));
  if (from !== null) {
    const src = out.find((d) => d.key === from);
    const a = src?.allocations.find((x) => x.fillId === fillId);
    if (!src || !a) return drafts;
    qty = Math.min(qty, a.qty);
    src.allocations = src.allocations
      .map((x) => (x.fillId === fillId ? { ...x, qty: x.qty - qty } : x))
      .filter((x) => x.qty > 0);
    src.linkTradeId = null;
  }
  if (to === "new") {
    out.push({
      key: newKey(),
      allocations: [{ fillId, qty }],
      direction: null,
      entry: "",
      exit: "",
      linkTradeId: null,
      playbookId: null,
    });
  } else if (to !== null) {
    const dst = out.find((d) => d.key === to);
    if (!dst) return drafts;
    const have = dst.allocations.find((x) => x.fillId === fillId);
    dst.allocations = have
      ? dst.allocations.map((x) => (x.fillId === fillId ? { ...x, qty: x.qty + qty } : x))
      : [...dst.allocations, { fillId, qty }];
    dst.linkTradeId = null;
  }
  out = out.filter((d) => d.allocations.length > 0);
  return out;
}

export type RpcTrade = {
  direction: Direction;
  entry_at?: string;
  exit_at?: string;
  link_trade_id?: string;
  playbook_id?: string;
  allocations: { fill_id: string; qty: number }[];
};

export type PayloadResult =
  { ok: true; trades: RpcTrade[] } | { ok: false; errors: { key: string; message: string }[] };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Drafts → `build_statement_trades` payload (times in the display zone). */
export function toPayload(drafts: DraftTrade[], tradeDate: string, tz?: string): PayloadResult {
  const errors: { key: string; message: string }[] = [];
  const trades: RpcTrade[] = [];
  drafts.forEach((d, i) => {
    const n = i + 1;
    if (!d.direction) errors.push({ key: d.key, message: `Trade ${n}: choose long or short.` });
    const t: RpcTrade = {
      direction: d.direction ?? "long",
      allocations: d.allocations.map((a) => ({ fill_id: a.fillId, qty: a.qty })),
    };
    if (d.linkTradeId) t.link_trade_id = d.linkTradeId;
    if (d.playbookId) t.playbook_id = d.playbookId;
    if (d.entry || d.exit) {
      if (!HHMM.test(d.entry) || (d.exit && !HHMM.test(d.exit))) {
        errors.push({ key: d.key, message: `Trade ${n}: times are HH:MM (exit optional).` });
      } else {
        t.entry_at = localInputToIso(`${tradeDate}T${d.entry}`, tz) ?? undefined;
        if (d.exit) t.exit_at = localInputToIso(`${tradeDate}T${d.exit}`, tz) ?? undefined;
        if (t.entry_at && t.exit_at && t.exit_at < t.entry_at)
          errors.push({ key: d.key, message: `Trade ${n}: exit is before entry.` });
      }
    }
    trades.push(t);
  });
  return errors.length ? { ok: false, errors } : { ok: true, trades };
}

// ---------------------------------------------------------------------------
// Local draft copy (survives a reload or a closed tab)
// ---------------------------------------------------------------------------

export const draftKey = (productId: string) => `cg:split:${productId}`;

export type StoredDraft = { v: 1; at: number; mode: string; drafts: DraftTrade[] };

/** A stored draft, if it still fits the product's fills (never over-allocates). */
export function restoreDraft(raw: string | null, fills: SplitFill[]): StoredDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as StoredDraft;
    if (d?.v !== 1 || !Array.isArray(d.drafts)) return null;
    const qty = new Map(fills.map((f) => [f.id, f.qty]));
    const used = new Map<string, number>();
    for (const t of d.drafts) {
      if (!Array.isArray(t.allocations) || typeof t.key !== "string") return null;
      for (const a of t.allocations) {
        if (!qty.has(a.fillId) || !Number.isInteger(a.qty) || a.qty <= 0) return null;
        used.set(a.fillId, (used.get(a.fillId) ?? 0) + a.qty);
      }
    }
    for (const [id, q] of used) if (q > (qty.get(id) ?? 0)) return null;
    return {
      ...d,
      drafts: d.drafts.map((t) => ({
        key: t.key,
        allocations: t.allocations,
        direction: t.direction === "long" || t.direction === "short" ? t.direction : null,
        entry: typeof t.entry === "string" ? t.entry : "",
        exit: typeof t.exit === "string" ? t.exit : "",
        linkTradeId: typeof t.linkTradeId === "string" ? t.linkTradeId : null,
        playbookId: typeof t.playbookId === "string" ? t.playbookId : null,
      })),
    };
  } catch {
    return null;
  }
}
