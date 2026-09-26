import type { GroupedTrade } from "./group";
import type { Fill } from "./parse";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identity of a fill: account, symbol, time, price, quantity, side (spec §7). */
export function fillKey(
  f: Pick<Fill, "account" | "rawSymbol" | "at" | "price" | "qty" | "side">,
): string {
  return [f.account, f.rawSymbol.toUpperCase(), f.at, String(f.price), String(f.qty), f.side].join(
    "|",
  );
}

/**
 * Hash of a fill. `occurrence` numbers identical fills within one file (two
 * 1-lot fills at the same price and second), so both are kept and a re-import
 * of the same file still matches.
 */
export function fillHash(f: Parameters<typeof fillKey>[0], occurrence = 0): Promise<string> {
  return sha256(occurrence ? `${fillKey(f)}#${occurrence}` : fillKey(f));
}

/** A trade's import hash: its fills' hashes (with the quantity used) in order. */
export async function tradeHash(t: GroupedTrade, hashOf: Map<Fill, string>): Promise<string> {
  const parts = [...t.entries, ...t.exits].map((l) => `${hashOf.get(l.fill)}:${l.qty}`);
  return sha256(parts.join(","));
}
