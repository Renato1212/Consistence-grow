import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerError } from "@/lib/errors";

import { StatementFormatError } from "./axia";
import { MAX_STATEMENT_BYTES } from "./extract";
import { prepareStatement, type PreparedStatement } from "./payload";
import { AXIA_CODES, multiplierMatches } from "./products";

export type ReadResult =
  | { ok: true; prepared: PreparedStatement; bytes: Uint8Array }
  | { ok: false; status: number; error: string };

/** Validate and parse an uploaded file; never throws for bad input. */
export async function readStatementFile(
  bytes: Uint8Array,
  fileName: string | null,
): Promise<ReadResult> {
  if (!bytes.length) return { ok: false, status: 400, error: "The file is empty" };
  if (bytes.length > MAX_STATEMENT_BYTES)
    return { ok: false, status: 413, error: "Statements are limited to 10 MB" };
  // "%PDF" magic bytes.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46))
    return { ok: false, status: 415, error: "This is not a PDF" };
  try {
    const prepared = await prepareStatement(bytes, { fileName });
    if (prepared.parsed.unparsed.length) {
      // Only counts: never the statement's contents.
      await logServerError("statements.layout", new Error("Unrecognised statement lines"), {
        unparsed: prepared.parsed.unparsed.length,
        parser: prepared.payload.parser_version,
      });
    }
    return { ok: true, prepared, bytes };
  } catch (e) {
    await logServerError("statements.parse", e, { bytes: bytes.length });
    const hint = " If Axia changed the statement layout, keep this PDF: the parser needs updating.";
    if (e instanceof StatementFormatError)
      return { ok: false, status: 422, error: e.message + hint };
    return {
      ok: false,
      status: 422,
      error: "The PDF could not be read as an Axia Daily Detail Statement." + hint,
    };
  }
}

export type ExistingInfo =
  | { state: "new" }
  | { state: "duplicate"; id: string }
  | {
      state: "conflict";
      id: string;
      changes: { field: string; before: number | null; after: number | null }[];
    };

/** How a parsed statement relates to what is already stored (for the preview). */
export async function existingFor(
  supabase: SupabaseClient,
  prepared: PreparedStatement,
): Promise<ExistingInfo> {
  const p = prepared.payload;
  const { data } = await supabase
    .from("statements")
    .select("id, file_hash, realized_pnl, close_cash, net_liquid_value, contracts, total_fees")
    .eq("account", p.account)
    .eq("trade_date", p.trade_date)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) {
    const same = await supabase
      .from("statements")
      .select("id")
      .eq("file_hash", p.file_hash)
      .is("deleted_at", null)
      .maybeSingle();
    return same.data ? { state: "duplicate", id: same.data.id } : { state: "new" };
  }
  if (data.file_hash === p.file_hash) return { state: "duplicate", id: data.id };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const fields: [string, unknown, number | null][] = [
    ["Realized P/L", data.realized_pnl, p.realized_pnl],
    ["Fees", data.total_fees, p.total_fees],
    ["Close cash", data.close_cash, p.close_cash],
    ["Net liquid value", data.net_liquid_value, p.net_liquid_value],
    ["Contracts", data.contracts, p.contracts],
  ];
  return {
    state: "conflict",
    id: data.id,
    changes: fields
      .map(([field, before, after]) => ({ field, before: num(before), after }))
      .filter((c) => c.before !== c.after),
  };
}

export type PreviewMapping = {
  code: string;
  symbol: string | null;
  source: "user" | "default" | "description" | null;
  /** Implied contract multiplier agrees with the instrument (null = cannot tell). */
  ok: boolean | null;
};

/** Where each product of a parsed statement will land (the owner's map wins). */
export async function previewMappings(
  supabase: SupabaseClient,
  prepared: PreparedStatement,
): Promise<PreviewMapping[]> {
  const [map, inst] = await Promise.all([
    supabase
      .from("statement_code_map")
      .select("code, price_scale, instrument:instruments(symbol)")
      .is("deleted_at", null),
    supabase.from("instruments").select("symbol, tick_size, tick_value").is("deleted_at", null),
  ]);
  const user = new Map(
    (map.data ?? []).map((m) => [
      m.code as string,
      {
        symbol: (m.instrument as unknown as { symbol: string } | null)?.symbol ?? null,
        scale: Number(m.price_scale),
      },
    ]),
  );
  const specs = new Map(
    (inst.data ?? []).map((i) => [
      i.symbol as string,
      { tickSize: Number(i.tick_size), tickValue: Number(i.tick_value) },
    ]),
  );
  return prepared.payload.products.map((p) => {
    const own = user.get(p.code);
    const symbol = own?.symbol ?? p.default_symbol;
    const scale = own ? own.scale : p.price_scale;
    const source = own
      ? "user"
      : p.default_symbol
        ? AXIA_CODES[p.code]
          ? "default"
          : "description"
        : null;
    const spec = symbol ? specs.get(symbol) : undefined;
    return {
      code: p.code,
      symbol: spec ? symbol : null,
      source: spec ? source : null,
      ok: spec ? multiplierMatches(p.implied_multiplier, spec, scale) : null,
    };
  });
}
