import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { outputSchema, validationErrors } from "@/lib/ai/schema";
import { bearer, fail, rpcFailure, tokenClient } from "@/lib/ai/server";

/**
 * POST /api/ai/findings — store the analysis of one queued request.
 *
 *   Authorization: Bearer cg_…   (token with the "ai" scope)
 *   { "request_id": "…", "data_hash": "…", "model": "claude-…", "output": { summary, findings[] } }
 *
 * 422 with `errors` when the output breaks the schema or cites ids that were
 * not in the payload — fix and post again.
 */
const MAX_BYTES = 200_000;

const bodySchema = z.object({
  request_id: z.string().uuid(),
  data_hash: z.string().min(1).max(64),
  model: z.string().max(100).optional(),
  output: z.unknown(),
});

export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) return fail(401, "Missing bearer token");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES)
    return fail(413, "Body too large");

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return fail(400, "Body is not valid JSON");
  }
  const body = bodySchema.safeParse(input);
  if (!body.success) return fail(400, "Expected { request_id, data_hash, model?, output }");
  const output = outputSchema.safeParse(body.data.output);
  if (!output.success) {
    return fail(422, "output does not match the schema", {
      errors: validationErrors(output.error),
    });
  }

  const { data, error } = await tokenClient().rpc("ai_submit", {
    p_token: token,
    p_request: body.data.request_id,
    p_data_hash: body.data.data_hash,
    p_output: output.data as never,
    p_model: body.data.model ?? "claude",
  });
  if (error) return rpcFailure(error, "submit");
  return NextResponse.json({ ok: true, insight_id: data });
}
