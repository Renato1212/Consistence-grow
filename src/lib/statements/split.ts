/**
 * Split a statement product's day into round-trip trades.
 *
 * The Axia statement lists a product's fills buys first, then sells, sorted by
 * price, without times — so which buy was closed by which sell is not in the
 * PDF. Every day is flat, so any split into flat groups adds up exactly to the
 * broker's realized P/L; only the per-trade P/L depends on the split. This
 * module proposes splits (always labelled as suggestions), checks drafts and
 * matches trades already in the journal to the broker fills.
 *
 * Prices here are instrument prices (statement price × price scale).
 */

export type Side = "buy" | "sell";
export type Direction = "long" | "short";

export type SplitFill = { id: string; side: Side; qty: number; price: number };
export type Allocation = { fillId: string; qty: number };
export type Group = Allocation[];

export type SplitSpec = { tickSize: number; tickValue: number };

/** Dollars per 1.0 of instrument price per contract. */
export const pointValue = (spec: SplitSpec) => spec.tickValue / spec.tickSize;

const cents = (v: number) => Math.round(v * 100) / 100;
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Trade maths
// ---------------------------------------------------------------------------

export type GroupMath = {
  buyQty: number;
  sellQty: number;
  balanced: boolean;
  contracts: number;
  avgBuy: number | null;
  avgSell: number | null;
  /** (Σ sell − Σ buy) × point value, to the cent. Direction does not change it. */
  gross: number;
  /** The same, unrounded (sum these, then round). */
  grossRaw: number;
  /** Price span of the group's fills (max − min). */
  span: number;
  fills: number;
};

export function groupMath(group: Group, fills: Map<string, SplitFill>, spec: SplitSpec): GroupMath {
  let buyQty = 0;
  let sellQty = 0;
  let buyVal = 0;
  let sellVal = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of group) {
    const f = fills.get(a.fillId);
    if (!f || a.qty <= 0) continue;
    if (f.side === "buy") {
      buyQty += a.qty;
      buyVal += a.qty * f.price;
    } else {
      sellQty += a.qty;
      sellVal += a.qty * f.price;
    }
    lo = Math.min(lo, f.price);
    hi = Math.max(hi, f.price);
  }
  return {
    buyQty,
    sellQty,
    balanced: buyQty > 0 && buyQty === sellQty,
    contracts: Math.min(buyQty, sellQty),
    avgBuy: buyQty ? buyVal / buyQty : null,
    avgSell: sellQty ? sellVal / sellQty : null,
    gross: cents((sellVal - buyVal) * pointValue(spec)),
    grossRaw: (sellVal - buyVal) * pointValue(spec),
    span: Number.isFinite(hi - lo) ? hi - lo : 0,
    fills: group.length,
  };
}

/** Entry/exit prices of a flat group for a direction (long: buy → sell). */
export function entryExit(m: GroupMath, direction: Direction) {
  return direction === "long"
    ? { entry: m.avgBuy, exit: m.avgSell }
    : { entry: m.avgSell, exit: m.avgBuy };
}

/** Ticks of a flat group (same sign as its P/L). */
export function groupTicks(m: GroupMath, spec: SplitSpec): number | null {
  if (m.avgBuy === null || m.avgSell === null) return null;
  return Math.round(((m.avgSell - m.avgBuy) / spec.tickSize) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Checks on a draft split
// ---------------------------------------------------------------------------

export type SplitIssue =
  | { kind: "not-flat"; bought: number; sold: number }
  | { kind: "unallocated"; fillId: string; qty: number }
  | { kind: "over-allocated"; fillId: string; qty: number }
  | { kind: "unbalanced"; group: number; buyQty: number; sellQty: number }
  | { kind: "empty"; group: number }
  | { kind: "no-price"; fillId: string }
  | { kind: "total"; expected: number; actual: number };

export type SplitCheck = {
  ok: boolean;
  issues: SplitIssue[];
  groups: GroupMath[];
  total: number;
  /** Quantity left to allocate per fill (0 when fully used). */
  remaining: Map<string, number>;
};

/**
 * The broker rounds each fill's amount to the cent (32nds prices do not land on
 * cents), so its realized P/L can differ from the exact price maths by up to
 * about half a cent per fill — the same allowance as the statement checks.
 */
export const totalTolerance = (fills: number) => Math.max(0.011, 0.006 * fills);

/**
 * Check a draft against the product's fills: the product is flat, every fill
 * is allocated exactly once, every group is flat and the sum of the groups is
 * the broker's realized P/L (±$0.01; `realized` null skips that check).
 */
export function checkSplit(
  fills: SplitFill[],
  groups: Group[],
  spec: SplitSpec,
  realized: number | null,
): SplitCheck {
  const byId = new Map(fills.map((f) => [f.id, f]));
  const issues: SplitIssue[] = [];
  const bought = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.qty, 0);
  const sold = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.qty, 0);
  if (bought !== sold) issues.push({ kind: "not-flat", bought, sold });
  for (const f of fills)
    if (!Number.isFinite(f.price)) issues.push({ kind: "no-price", fillId: f.id });

  const used = new Map<string, number>();
  for (const g of groups) for (const a of g) used.set(a.fillId, (used.get(a.fillId) ?? 0) + a.qty);
  const remaining = new Map<string, number>();
  for (const f of fills) {
    const left = f.qty - (used.get(f.id) ?? 0);
    remaining.set(f.id, Math.max(0, left));
    if (left > 0) issues.push({ kind: "unallocated", fillId: f.id, qty: left });
    if (left < 0) issues.push({ kind: "over-allocated", fillId: f.id, qty: -left });
  }

  const maths = groups.map((g) => groupMath(g, byId, spec));
  maths.forEach((m, i) => {
    if (m.buyQty === 0 && m.sellQty === 0) issues.push({ kind: "empty", group: i });
    else if (!m.balanced)
      issues.push({ kind: "unbalanced", group: i, buyQty: m.buyQty, sellQty: m.sellQty });
  });
  const raw = maths.reduce((s, m) => s + m.grossRaw, 0);
  const total = cents(raw);
  const complete = !issues.length;
  if (complete && realized !== null && Math.abs(raw - realized) > totalTolerance(fills.length))
    issues.push({ kind: "total", expected: realized, actual: total });
  return { ok: issues.length === 0, issues, groups: maths, total, remaining };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type Suggestion = {
  id: "finest" | "one" | "fewer" | "journal";
  label: string;
  detail: string;
  groups: Group[];
  /** The exact solver ran (else a greedy approximation). */
  exact: boolean;
};

/** Fills kept whole by the solver. Merges identical side+price fills when too many. */
type Item = { side: Side; qty: number; price: number; fills: { id: string; qty: number }[] };

export const EXACT_LIMIT = 20;

function toItems(fills: SplitFill[]): { items: Item[]; merged: boolean } {
  const items: Item[] = fills
    .filter((f) => f.qty > 0)
    .map((f) => ({ side: f.side, qty: f.qty, price: f.price, fills: [{ id: f.id, qty: f.qty }] }));
  if (items.length <= EXACT_LIMIT) return { items, merged: false };
  const byKey = new Map<string, Item>();
  for (const it of items) {
    const k = `${it.side}|${it.price}`;
    const have = byKey.get(k);
    if (have) {
      have.qty += it.qty;
      have.fills.push(...it.fills);
    } else byKey.set(k, { ...it, fills: [...it.fills] });
  }
  return { items: [...byKey.values()], merged: true };
}

const itemsToGroup = (items: Item[], mask: number): Group => {
  const out: Group = [];
  items.forEach((it, i) => {
    if (mask & (1 << i)) for (const f of it.fills) out.push({ fillId: f.id, qty: f.qty });
  });
  return out;
};

function spanOf(items: Item[], mask: number) {
  let lo = Infinity;
  let hi = -Infinity;
  items.forEach((it, i) => {
    if (mask & (1 << i)) {
      lo = Math.min(lo, it.price);
      hi = Math.max(hi, it.price);
    }
  });
  return hi - lo;
}

/**
 * Exact: the partition into the most flat groups (whole fills), ties broken by
 * the smallest total price span (fills of a trade tend to sit close together).
 * Only minimal flat groups can appear in such a partition, so only those are
 * enumerated. n ≤ EXACT_LIMIT.
 */
function exactFinest(items: Item[]): number[] | null {
  const n = items.length;
  if (n === 0) return [];
  if (n > EXACT_LIMIT) return null;
  const N = 1 << n;
  const signed = items.map((it) => (it.side === "buy" ? it.qty : -it.qty));
  const sum = new Int32Array(N);
  const sides = new Uint8Array(N); // bit0 buy, bit1 sell
  const balanced = new Uint8Array(N);
  for (let m = 1; m < N; m++) {
    const low = m & -m;
    const b = 31 - Math.clz32(low);
    sum[m] = sum[m ^ low] + signed[b];
    sides[m] = sides[m ^ low] | (signed[b] > 0 ? 1 : 2);
    balanced[m] = sum[m] === 0 && sides[m] === 3 ? 1 : 0;
  }
  if (sum[N - 1] !== 0) return null;
  // hasSub[m]: some proper non-empty submask of m is balanced.
  const hasSub = new Uint8Array(N);
  for (let m = 1; m < N; m++) {
    let v = 0;
    for (let r = m; r && !v; r &= r - 1) {
      const s = m ^ (r & -r);
      if (s && (balanced[s] || hasSub[s])) v = 1;
    }
    hasSub[m] = v;
  }
  const byLow: number[][] = Array.from({ length: n }, () => []);
  for (let m = 1; m < N; m++) if (balanced[m] && !hasSub[m]) byLow[31 - Math.clz32(m & -m)].push(m);
  const spans = new Map<number, number>();
  const span = (m: number) => {
    let s = spans.get(m);
    if (s === undefined) spans.set(m, (s = spanOf(items, m)));
    return s;
  };

  type Best = { groups: number; span: number; pick: number };
  const memo = new Map<number, Best | null>();
  const solve = (mask: number): Best | null => {
    if (mask === 0) return { groups: 0, span: 0, pick: 0 };
    const hit = memo.get(mask);
    if (hit !== undefined) return hit;
    const low = 31 - Math.clz32(mask & -mask);
    let best: Best | null = null;
    for (const blk of byLow[low]) {
      if ((blk & mask) !== blk) continue;
      const rest = solve(mask ^ blk);
      if (!rest) continue;
      const groups = rest.groups + 1;
      const s = rest.span + span(blk);
      if (!best || groups > best.groups || (groups === best.groups && s < best.span - EPS))
        best = { groups, span: s, pick: blk };
    }
    memo.set(mask, best);
    return best;
  };
  const out: number[] = [];
  for (let mask = N - 1; mask;) {
    const b = solve(mask);
    if (!b) return null;
    out.push(b.pick);
    mask ^= b.pick;
  }
  return out;
}

/**
 * Greedy for big days: repeatedly take the tightest flat pair or triple of
 * whole fills; whatever is left (flat, since the day is flat) is one group.
 */
function greedyFinest(items: Item[]): number[][] {
  const left = new Set(items.map((_, i) => i));
  const groups: number[][] = [];
  const buys = () => [...left].filter((i) => items[i].side === "buy");
  const sells = () => [...left].filter((i) => items[i].side === "sell");
  const spanIdx = (ix: number[]) => {
    const p = ix.map((i) => items[i].price);
    return Math.max(...p) - Math.min(...p);
  };
  for (;;) {
    let best: { ix: number[]; span: number } | null = null;
    const B = buys();
    const S = sells();
    const consider = (ix: number[]) => {
      const s = spanIdx(ix);
      if (!best || s < best.span - EPS) best = { ix, span: s };
    };
    for (const b of B)
      for (const s of S) {
        if (items[b].qty === items[s].qty) consider([b, s]);
      }
    if (!best && B.length * S.length * Math.max(B.length, S.length) <= 200_000) {
      for (const b of B)
        for (let i = 0; i < S.length; i++)
          for (let j = i + 1; j < S.length; j++)
            if (items[b].qty === items[S[i]].qty + items[S[j]].qty) consider([b, S[i], S[j]]);
      for (const s of S)
        for (let i = 0; i < B.length; i++)
          for (let j = i + 1; j < B.length; j++)
            if (items[s].qty === items[B[i]].qty + items[B[j]].qty) consider([s, B[i], B[j]]);
    }
    if (!best) break;
    const pick: number[] = (best as { ix: number[] }).ix;
    groups.push(pick);
    for (const i of pick) left.delete(i);
  }
  if (left.size) groups.push([...left]);
  return groups;
}

/** Merge the two groups whose union grows the total span least, until `k` remain. */
export function mergeTo(groups: Group[], fills: SplitFill[], k: number): Group[] {
  const byId = new Map(fills.map((f) => [f.id, f]));
  const range = (g: Group) => {
    const p = g.map((a) => byId.get(a.fillId)?.price ?? 0);
    return { lo: Math.min(...p), hi: Math.max(...p) };
  };
  const out = groups.map((g) => [...g]);
  while (out.length > Math.max(1, k)) {
    let best = { i: 0, j: 1, cost: Infinity };
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = range(out[i]);
        const b = range(out[j]);
        const cost = Math.max(a.hi, b.hi) - Math.min(a.lo, b.lo) - (a.hi - a.lo) - (b.hi - b.lo);
        if (cost < best.cost - EPS) best = { i, j, cost };
      }
    out[best.i] = [...out[best.i], ...out[best.j]];
    out.splice(best.j, 1);
  }
  return out;
}

/** Stable order: by the price of each group's first buy, then sell. */
function orderGroups(groups: Group[], fills: SplitFill[]): Group[] {
  const byId = new Map(fills.map((f) => [f.id, f]));
  const pos = new Map(fills.map((f, i) => [f.id, i]));
  const sortG = (g: Group) =>
    [...g].sort((a, b) => (pos.get(a.fillId) ?? 0) - (pos.get(b.fillId) ?? 0));
  const key = (g: Group) => Math.min(...g.map((a) => byId.get(a.fillId)?.price ?? Infinity));
  return groups.map(sortG).sort((a, b) => key(a) - key(b));
}

export type Finest = { groups: Group[]; exact: boolean };

/** The finest flat split of a flat product (null when the product is not flat). */
export function finestSplit(fills: SplitFill[]): Finest | null {
  const bought = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.qty, 0);
  const sold = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.qty, 0);
  if (bought !== sold || bought === 0) return null;
  const { items, merged } = toItems(fills);
  const exact = exactFinest(items);
  if (exact)
    return {
      groups: orderGroups(
        exact.map((m) => itemsToGroup(items, m)),
        fills,
      ),
      exact: !merged,
    };
  const greedy = greedyFinest(items).map((ix) =>
    ix.flatMap((i) => items[i].fills.map((f) => ({ fillId: f.id, qty: f.qty }))),
  );
  return { groups: orderGroups(greedy, fills), exact: false };
}

export const oneTrade = (fills: SplitFill[]): Group[] => [
  fills.filter((f) => f.qty > 0).map((f) => ({ fillId: f.id, qty: f.qty })),
];

/**
 * Suggestions for a product: the finest split (most trades), then one trade
 * for the whole product. `fewer(k)` merges the finest split down to k trades.
 */
export function suggestSplits(fills: SplitFill[]): Suggestion[] {
  const finest = finestSplit(fills);
  if (!finest) return [];
  const one: Suggestion = {
    id: "one",
    label: "One trade",
    detail: "Every fill of the day as a single trade (always adds up).",
    groups: oneTrade(fills),
    exact: true,
  };
  if (finest.groups.length <= 1) return [{ ...one, detail: "Only one flat split exists." }];
  return [
    {
      id: "finest",
      label: `${finest.groups.length} trades`,
      detail: finest.exact
        ? "The most flat trades these fills allow, grouping fills that sit close in price."
        : "A quick approximation (many fills): tightest flat pairs first.",
      groups: finest.groups,
      exact: finest.exact,
    },
    one,
  ];
}

/** The finest split merged down to `k` trades (k between 1 and the finest count). */
export function splitInto(fills: SplitFill[], k: number): Group[] {
  const finest = finestSplit(fills);
  if (!finest) return [];
  return orderGroups(mergeTo(finest.groups, fills, k), fills);
}

/**
 * True when there is only one sensible split: one side is a single fill and
 * no smaller flat group exists (e.g. bought 3 at once, sold 2 + 1).
 */
export function isUnambiguous(fills: SplitFill[]): boolean {
  const finest = finestSplit(fills);
  if (!finest || finest.groups.length !== 1) return false;
  const buys = fills.filter((f) => f.side === "buy").length;
  const sells = fills.filter((f) => f.side === "sell").length;
  return buys === 1 || sells === 1;
}

// ---------------------------------------------------------------------------
// Journal trades → broker fills
// ---------------------------------------------------------------------------

export type JournalCandidate = {
  id: string;
  direction: Direction;
  contracts: number;
  entryPrice: number;
  exitPrice: number | null;
  /** Timestamped platform fills (CSV import), if any. */
  fills?: { side: Side; qty: number; price: number }[];
};

export type JournalMatch = {
  /** Allocations per journal trade, in the order given. */
  trades: { id: string; allocations: Allocation[] }[];
  /** "fills": platform fills matched per price; "prices": contracts and average prices. */
  method: "fills" | "prices";
};

const priceKey = (p: number, tick: number) => Math.round(p / (tick / 2));

/**
 * Journal trades that carry platform fills: each statement fill is shared out
 * to the trades that executed that side at that price. Exact when every
 * side × price quantity agrees (null otherwise).
 */
function matchByFills(fills: SplitFill[], trades: JournalCandidate[], tick: number) {
  if (!trades.length || trades.some((t) => !t.fills?.length)) return null;
  type Need = { trade: number; qty: number };
  const needs = new Map<string, Need[]>();
  for (const [i, t] of trades.entries())
    for (const f of t.fills!) {
      const k = `${f.side}|${priceKey(f.price, tick)}`;
      const list = needs.get(k) ?? [];
      const have = list.find((n) => n.trade === i);
      if (have) have.qty += f.qty;
      else list.push({ trade: i, qty: f.qty });
      needs.set(k, list);
    }
  const out = trades.map(() => [] as Allocation[]);
  for (const f of fills) {
    const list = needs.get(`${f.side}|${priceKey(f.price, tick)}`);
    let left = f.qty;
    for (const n of list ?? []) {
      if (!left) break;
      const q = Math.min(left, n.qty);
      if (q <= 0) continue;
      out[n.trade].push({ fillId: f.id, qty: q });
      n.qty -= q;
      left -= q;
    }
    if (left) return null;
  }
  for (const list of needs.values()) if (list.some((n) => n.qty !== 0)) return null;
  return out;
}

/**
 * Journal trades typed by hand (contracts + average prices): find whole-fill
 * subsets per trade whose size and average price match (±half a tick), every
 * fill used once. Bounded search; null when nothing fits.
 */
function matchByPrices(fills: SplitFill[], trades: JournalCandidate[], tick: number) {
  const tol = tick / 2 + EPS;
  const buys = fills.filter((f) => f.side === "buy");
  const sells = fills.filter((f) => f.side === "sell");
  if (buys.length > 14 || sells.length > 14 || trades.some((t) => t.exitPrice === null))
    return null;
  const subsets = (list: SplitFill[]) => {
    const out: { mask: number; qty: number; avg: number }[] = [];
    for (let m = 1; m < 1 << list.length; m++) {
      let q = 0;
      let v = 0;
      list.forEach((f, i) => {
        if (m & (1 << i)) {
          q += f.qty;
          v += f.qty * f.price;
        }
      });
      out.push({ mask: m, qty: q, avg: v / q });
    }
    return out;
  };
  const B = subsets(buys);
  const S = subsets(sells);
  const cands = trades.map((t) => {
    const buyPx = t.direction === "long" ? t.entryPrice : t.exitPrice!;
    const sellPx = t.direction === "long" ? t.exitPrice! : t.entryPrice;
    return {
      b: B.filter((x) => x.qty === t.contracts && Math.abs(x.avg - buyPx) <= tol),
      s: S.filter((x) => x.qty === t.contracts && Math.abs(x.avg - sellPx) <= tol),
    };
  });
  if (cands.some((c) => !c.b.length || !c.s.length)) return null;
  let budget = 200_000;
  const pick: { b: number; s: number }[] = [];
  const go = (i: number, usedB: number, usedS: number): boolean => {
    if (--budget < 0) return false;
    if (i === trades.length)
      return usedB === (1 << buys.length) - 1 && usedS === (1 << sells.length) - 1;
    for (const b of cands[i].b) {
      if (b.mask & usedB) continue;
      for (const s of cands[i].s) {
        if (s.mask & usedS) continue;
        pick[i] = { b: b.mask, s: s.mask };
        if (go(i + 1, usedB | b.mask, usedS | s.mask)) return true;
      }
    }
    return false;
  };
  if (!go(0, 0, 0)) return null;
  return pick.map(({ b, s }) => [
    ...buys.filter((_, i) => b & (1 << i)).map((f) => ({ fillId: f.id, qty: f.qty })),
    ...sells.filter((_, i) => s & (1 << i)).map((f) => ({ fillId: f.id, qty: f.qty })),
  ]);
}

/**
 * Match the journal trades of the product's day to its broker fills, so they
 * can be linked instead of logged again. Null when they do not add up to the
 * broker fills exactly.
 */
export function matchJournal(
  fills: SplitFill[],
  trades: JournalCandidate[],
  spec: SplitSpec,
): JournalMatch | null {
  if (!trades.length) return null;
  const total = (side: Side) => fills.filter((f) => f.side === side).reduce((s, f) => s + f.qty, 0);
  const contracts = trades.reduce((s, t) => s + t.contracts, 0);
  if (contracts !== total("buy") || contracts !== total("sell")) return null;
  const viaFills = matchByFills(fills, trades, spec.tickSize);
  if (viaFills)
    return {
      method: "fills",
      trades: trades.map((t, i) => ({ id: t.id, allocations: viaFills[i] })),
    };
  const viaPrices = matchByPrices(fills, trades, spec.tickSize);
  if (viaPrices)
    return {
      method: "prices",
      trades: trades.map((t, i) => ({ id: t.id, allocations: viaPrices[i] })),
    };
  return null;
}
