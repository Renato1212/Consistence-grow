/**
 * Deterministic, synchronous 53-bit string hash (cyrb53), identical in the
 * browser and on the server. Used to recognise "same filter, same data" so an
 * analysis is not repeated; not a security primitive.
 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Bump when the payload or instructions change so old results are not reused. */
export const PAYLOAD_VERSION = 1;

/**
 * Version of the data an analysis looked at: kind, filter, week and every
 * trade's id + last edit. Extra strings (weekly reflection, debriefs) are
 * folded in by the caller.
 */
export function dataHash(parts: {
  kind: string;
  filterKey: string;
  week?: string | null;
  trades: { id: string; updated_at?: string | null }[];
  extra?: string;
}): string {
  const trades = parts.trades
    .map((t) => `${t.id}@${t.updated_at ?? ""}`)
    .sort()
    .join(",");
  return cyrb53(
    [
      `v${PAYLOAD_VERSION}`,
      parts.kind,
      parts.filterKey,
      parts.week ?? "",
      trades,
      parts.extra ?? "",
    ].join("|"),
  );
}
