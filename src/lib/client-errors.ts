"use client";

import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";

/**
 * Record a client-side failure in `error_logs`. Never throws; the user only
 * ever sees a calm "Something failed, retry".
 */
export function logClientError(
  source: string,
  error: unknown,
  context: { [key: string]: Json } = {},
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  console.error(`[${source}]`, message, context);
  void (async () => {
    try {
      await createClient().from("error_logs").insert({ source, message, context });
    } catch {
      /* logging must never throw */
    }
  })();
}
