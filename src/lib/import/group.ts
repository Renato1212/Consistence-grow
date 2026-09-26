/**
 * Group fills into round-trip trades: flat → flat per account and instrument,
 * in time order (file order breaks ties). Scaling in/out averages prices; a
 * fill that crosses zero closes the trade and opens the next one with the
 * remainder. A position still open at the end is reported, not imported.
 */
import type { Fill } from "./parse";

export type TradeLeg = { fill: Fill; qty: number };

export type GroupedTrade = {
  account: string;
  instrumentId: string;
  symbol: string;
  direction: "long" | "short";
  entryAt: string;
  exitAt: string;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  /** Sum of fill fees (pro-rated for split fills); null when the file has none. */
  fees: number | null;
  entries: TradeLeg[];
  exits: TradeLeg[];
};

export type Grouping = {
  trades: GroupedTrade[];
  open: { account: string; symbol: string; qty: number; fills: Fill[] }[];
};

const EPS = 1e-9;

function wavg(legs: TradeLeg[]): number {
  const q = legs.reduce((a, l) => a + l.qty, 0);
  return legs.reduce((a, l) => a + l.fill.price * l.qty, 0) / q;
}

function legFee(l: TradeLeg): number | null {
  return l.fill.fee === null ? null : (l.fill.fee * l.qty) / l.fill.qty;
}

function build(entries: TradeLeg[], exits: TradeLeg[]): GroupedTrade {
  const first = entries[0].fill;
  const legs = [...entries, ...exits];
  const fees = legs.some((l) => l.fill.fee !== null)
    ? Math.round(legs.reduce((a, l) => a + (legFee(l) ?? 0), 0) * 1e4) / 1e4
    : null;
  return {
    account: first.account,
    instrumentId: first.instrumentId,
    symbol: first.symbol,
    direction: first.side === "buy" ? "long" : "short",
    entryAt: first.at,
    exitAt: exits[exits.length - 1].fill.at,
    entryPrice: Math.round(wavg(entries) * 1e8) / 1e8,
    exitPrice: Math.round(wavg(exits) * 1e8) / 1e8,
    contracts: entries.reduce((a, l) => a + l.qty, 0),
    fees,
    entries,
    exits,
  };
}

export function groupFills(fills: Fill[]): Grouping {
  const books = new Map<string, Fill[]>();
  for (const f of fills) {
    const key = `${f.account}\u0000${f.instrumentId}`;
    const list = books.get(key);
    if (list) list.push(f);
    else books.set(key, [f]);
  }
  const trades: GroupedTrade[] = [];
  const open: Grouping["open"] = [];
  for (const list of books.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at) || a.row - b.row);
    let pos = 0; // signed contracts
    let entries: TradeLeg[] = [];
    let exits: TradeLeg[] = [];
    let used: Fill[] = [];
    for (const f of list) {
      const signed = f.side === "buy" ? f.qty : -f.qty;
      used.push(f);
      if (Math.abs(pos) < EPS || Math.sign(signed) === Math.sign(pos)) {
        entries.push({ fill: f, qty: f.qty });
        pos += signed;
        continue;
      }
      const closing = Math.min(Math.abs(pos), f.qty);
      exits.push({ fill: f, qty: closing });
      pos += Math.sign(signed) * closing;
      if (Math.abs(pos) < EPS) {
        trades.push(build(entries, exits));
        entries = [];
        exits = [];
        used = [];
        pos = 0;
        const rest = f.qty - closing;
        if (rest > EPS) {
          entries.push({ fill: f, qty: rest });
          pos = Math.sign(signed) * rest;
          used = [f];
        }
      }
    }
    if (Math.abs(pos) > EPS) {
      const first = used[0] ?? list[list.length - 1];
      open.push({ account: first.account, symbol: first.symbol, qty: pos, fills: used });
    }
  }
  trades.sort((a, b) => a.entryAt.localeCompare(b.entryAt));
  return { trades, open };
}
