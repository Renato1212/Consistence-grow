import { E2E_USER, ensureUser } from "../tests/local-supabase";

export default async function globalSetup() {
  await ensureUser(E2E_USER);
}
