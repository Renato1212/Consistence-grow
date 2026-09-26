/**
 * From parsed fills to an import plan: which trades are new, which were
 * imported before (any fill hash or the trade hash already stored), plus the
 * payload for the `import_trades` RPC.
 */
import { groupFills, type GroupedTrade } from "./group";
import { fillHash, fillKey, tradeHash } from "./hash";
import type { Fill } from "./parse";

export type PlannedTrade = GroupedTrade & {
  importHash: string;
  /** Each distinct fill of the trade once, with its hash (entry and exit order). */
  fills: { fill: Fill; hash: string }[];
  fillHashes: string[];
};

export type ImportPlan = {
  create: PlannedTrade[];
  duplicates: PlannedTrade[];
  open: ReturnType<typeof groupFills>["open"];
};

export async function planImport(
  fills: Fill[],
  isKnown: (
    fillHashes: string[],
    tradeHashes: string[],
  ) => Promise<{ fills: Set<string>; trades: Set<string> }>,
): Promise<ImportPlan> {
  const hashOf = new Map<Fill, string>();
  const seenKeys = new Map<string, number>();
  for (const f of fills) {
    const key = fillKey(f);
    const n = seenKeys.get(key) ?? 0;
    seenKeys.set(key, n + 1);
    hashOf.set(f, await fillHash(f, n));
  }
  const grouped = groupFills(fills);
  const planned: PlannedTrade[] = [];
  for (const t of grouped.trades) {
    const distinct = [...new Set([...t.entries, ...t.exits].map((l) => l.fill))];
    const withHash = distinct.map((fill) => ({ fill, hash: hashOf.get(fill)! }));
    planned.push({
      ...t,
      importHash: await tradeHash(t, hashOf),
      fills: withHash,
      fillHashes: withHash.map((f) => f.hash),
    });
  }
  const known = await isKnown(
    [...new Set(planned.flatMap((t) => t.fillHashes))],
    planned.map((t) => t.importHash),
  );
  const create: PlannedTrade[] = [];
  const duplicates: PlannedTrade[] = [];
  for (const t of planned) {
    if (known.trades.has(t.importHash) || t.fillHashes.some((h) => known.fills.has(h)))
      duplicates.push(t);
    else create.push(t);
  }
  return { create, duplicates, open: grouped.open };
}

/**
 * JSON for `import_trades`. A fill split by a reversal is stored once, with
 * the trade it closes (the earlier one).
 */
export function rpcPayload(trades: PlannedTrade[]) {
  const seen = new Set<string>();
  return trades.map((t) => ({
    import_hash: t.importHash,
    instrument_id: t.instrumentId,
    direction: t.direction,
    entry_at: t.entryAt,
    exit_at: t.exitAt,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    contracts: t.contracts,
    fees: t.fees,
    fills: t.fills
      .filter(({ hash }) => !seen.has(hash) && (seen.add(hash), true))
      .map(({ fill, hash }) => ({
        hash,
        executed_at: fill.at,
        account: fill.account,
        symbol: fill.rawSymbol,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        raw: fill.raw,
      })),
  }));
}
