import { createClient } from "@/lib/supabase/server";
import { relativeRedirect } from "@/lib/redirect";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return relativeRedirect("/login");
}
