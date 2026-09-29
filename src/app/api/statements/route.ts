import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerError } from "@/lib/errors";
import { statementFilePath } from "@/lib/statements/payload";
import { existingFor, previewMappings, readStatementFile } from "@/lib/statements/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/statements — multipart form: file (PDF), mode ("preview" | "save"),
 * replace ("1" to replace a different statement of the same account and day).
 * The PDF is parsed on the server; nothing is stored in preview mode.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail(401, "Sign in first");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected a multipart form with a PDF file");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Attach the statement PDF");
  const mode = form.get("mode") === "save" ? "save" : "preview";
  const replace = form.get("replace") === "1";

  const read = await readStatementFile(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!read.ok) return fail(read.status, read.error);
  const { prepared, bytes } = read;

  try {
    if (mode === "preview") {
      const [existing, mappings] = await Promise.all([
        existingFor(supabase, prepared),
        previewMappings(supabase, prepared),
      ]);
      const preview = { ...prepared.payload, raw_text: undefined, fills: undefined };
      return NextResponse.json({ ok: true, preview, existing, mappings });
    }

    const saved = await supabase.rpc("save_statement", {
      p_statement: prepared.payload,
      p_replace: replace,
    });
    if (saved.error) {
      if (saved.error.code === "22023") return fail(400, saved.error.message);
      throw saved.error;
    }
    const result = saved.data as { status: string; id: string; replaced_id?: string };
    if (result.status === "conflict") {
      return NextResponse.json({ ok: false, error: "conflict", ...result }, { status: 409 });
    }
    if (result.status === "created" || result.status === "replaced") {
      // Keep the original PDF; the statement stays usable if storage fails.
      const path = statementFilePath(auth.user.id, prepared.payload);
      const up = await supabase.storage
        .from("statements")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (up.error) await logServerError("statements.upload", up.error);
      else await supabase.from("statements").update({ file_path: path }).eq("id", result.id);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await logServerError("statements.save", e);
    return fail(500, "Could not store the statement — retry");
  }
}
