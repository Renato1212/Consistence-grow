import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import { relativeRedirect } from "@/lib/redirect";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Magic-link landing. Supports both the PKCE `code` flow (default email
 * template) and the `token_hash` flow (custom templates).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return relativeRedirect(next);
    await logServerError("auth.callback.code", error);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return relativeRedirect(next);
    await logServerError("auth.callback.token_hash", error);
  }

  return relativeRedirect("/login?error=link");
}
