import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/**
 * Connection details of the LOCAL Supabase CLI stack. Read from env when set
 * (CI), otherwise from `supabase status`, so no keys live in the repo. Every
 * client refuses to run against anything but 127.0.0.1/localhost.
 */
type LocalStatus = { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

let cached: LocalStatus | null = null;

function localStatus(): LocalStatus {
  if (cached) return cached;
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } =
    process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY) {
    cached = {
      API_URL: NEXT_PUBLIC_SUPABASE_URL,
      PUBLISHABLE_KEY: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SECRET_KEY: SUPABASE_SECRET_KEY,
    };
  } else {
    const out = execSync("pnpm exec supabase status -o json", { encoding: "utf8" });
    cached = JSON.parse(out.slice(out.indexOf("{"))) as LocalStatus;
  }
  const host = new URL(cached.API_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run tests against non-local Supabase (${host}).`);
  }
  return cached;
}

export const E2E_USER = {
  email: "e2e@consistent-grow.test",
  password: "e2e-password-not-secret",
};

export const INTRUDER_USER = {
  email: "intruder@consistent-grow.test",
  password: "intruder-password-not-secret",
};

export function anonClient() {
  const local = localStatus();
  return createClient(local.API_URL, local.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function adminClient() {
  const local = localStatus();
  return createClient(local.API_URL, local.SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create (idempotently) a confirmed user with a password. */
export async function ensureUser(user: { email: string; password: string }) {
  const admin = adminClient();
  const { error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error && !/already been registered|already exists/i.test(error.message)) throw error;
}
