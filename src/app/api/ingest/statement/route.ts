import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { readStatementFile } from "@/lib/statements/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/ingest/statement — deliver a daily Axia statement PDF.
 *
 *   Authorization: Bearer cg_…     (Settings → Integrations, scope "Statements")
 *   Content-Type: application/pdf   (the raw file as the body)
 *   ?replace=1                      replace a different statement of the same day
 *
 * or multipart/form-data with a `file` field. Parsed and self-checked on the
 * server; the same file twice is a no-op. The token is checked inside
 * `ingest_statement` (only its SHA-256 is stored). Over the API the PDF itself
 * is not kept — its extracted text is.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return fail(401, "Missing bearer token");
  if (Number(req.headers.get("content-length") ?? 0) > 11 * 1024 * 1024)
    return fail(413, "Statements are limited to 10 MB");

  let bytes: Uint8Array;
  let name: string | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return fail(400, "Attach the PDF as the `file` field");
      bytes = new Uint8Array(await file.arrayBuffer());
      name = file.name;
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
  } catch {
    return fail(400, "Could not read the request body");
  }

  const read = await readStatementFile(bytes, name);
  if (!read.ok) return fail(read.status, read.error);
  const p = read.prepared.payload;

  const env = publicEnv();
  const supabase = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.rpc("ingest_statement", {
    p_token: token,
    p_statement: p,
    p_replace: req.nextUrl.searchParams.get("replace") === "1",
  });
  if (error) {
    if (error.code === "28000") return fail(401, "Invalid or revoked token");
    if (error.code === "22023") return fail(400, error.message);
    console.error("[ingest.statement]", error.message);
    return fail(500, "Could not store the statement — retry");
  }
  const result = data as { status: string; id: string };
  const body = {
    ...result,
    trade_date: p.trade_date,
    account: p.account,
    realized_pnl: p.realized_pnl,
    checks: p.status,
    failed_checks: p.checks.filter((c) => !c.ok && c.severity === "error").map((c) => c.label),
  };
  if (result.status === "conflict")
    return NextResponse.json(
      { ok: false, error: "A different statement for this day exists; send ?replace=1", ...body },
      { status: 409 },
    );
  return NextResponse.json({ ok: true, ...body });
}
