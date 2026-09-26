import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { parseEdition } from "@/lib/briefs/tldr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/ingest/brief — deliver a Macro Desk pre-session brief.
 *
 *   Authorization: Bearer cg_…            (Settings → Integrations)
 *   Content-Type: application/json
 *   { "edition": "eu" | "us", "markdown": "…", "date"?: "YYYY-MM-DD", "source"?: "macro-desk" }
 *
 * or Content-Type: text/markdown with ?edition=eu[&date=…] and the brief as body.
 * One brief per date and edition: sending again replaces it. No user session:
 * the token is checked inside `ingest_brief` (only its SHA-256 is stored).
 */
const MAX_BYTES = 400_000;

const bodySchema = z.object({
  edition: z.string(),
  markdown: z.string().min(1).max(200_000),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  source: z.string().max(60).optional(),
});

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) return fail(401, "Missing bearer token");

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return fail(413, "Brief too large (max 200,000 characters)");
  }

  let input: unknown;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      input = await req.json();
    } else {
      const sp = req.nextUrl.searchParams;
      input = {
        edition: sp.get("edition") ?? "",
        date: sp.get("date") ?? undefined,
        source: sp.get("source") ?? undefined,
        markdown: await req.text(),
      };
    }
  } catch {
    return fail(400, "Body is not valid JSON");
  }

  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) return fail(400, "Expected { edition, markdown, date?, source? }");
  const session = parseEdition(parsed.data.edition);
  if (!session) return fail(400, 'edition must be "eu" or "us"');

  const env = publicEnv();
  const supabase = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.rpc("ingest_brief", {
    p_token: token,
    p_session: session,
    p_markdown: parsed.data.markdown,
    p_date: parsed.data.date,
    p_source: parsed.data.source ?? "macro-desk",
  });
  if (error) {
    if (error.code === "28000") return fail(401, "Invalid or revoked token");
    if (error.code === "22023") return fail(400, error.message);
    console.error("[ingest.brief]", error.message);
    return fail(500, "Could not store the brief — retry");
  }
  return NextResponse.json({ ok: true, ...(data as object) });
}
