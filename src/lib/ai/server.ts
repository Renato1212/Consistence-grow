import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/** Anonymous client for the token-authenticated AI functions (no user session). */
export function tokenClient() {
  const env = publicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function bearer(req: NextRequest): string | null {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** Map a Postgres error from the ai_* functions to an HTTP response. */
export function rpcFailure(error: { code?: string; message: string }, where: string) {
  if (error.code === "28000") return fail(401, "Invalid or revoked token (needs the AI scope)");
  if (error.code === "P0002") return fail(404, error.message);
  if (error.code === "22023") return fail(422, error.message, { errors: [error.message] });
  console.error(`[ai.${where}]`, error.message);
  return fail(500, "Server error — retry");
}
