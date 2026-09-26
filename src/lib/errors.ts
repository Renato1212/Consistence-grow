import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Record a server-side failure in `error_logs`. Never throws: logging must not
 * turn a recoverable error into a crash. The user only ever sees "retry".
 */
export async function logServerError(
  source: string,
  error: unknown,
  context: { [key: string]: Json } = {},
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${source}]`, message, context);
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return; // RLS requires an authenticated user.
    await supabase.from("error_logs").insert({ source, message, context });
  } catch (loggingError) {
    console.error("[logServerError] failed to persist", loggingError);
  }
}
