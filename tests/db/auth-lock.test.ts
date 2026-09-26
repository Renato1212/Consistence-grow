import { describe, expect, it } from "vitest";

import { E2E_USER, INTRUDER_USER, adminClient, anonClient, ensureUser } from "../local-supabase";

describe("single-user sign-up lock", () => {
  it("rejects sign-up for an email that is not allow-listed", async () => {
    const email = `stranger-${Date.now()}@example.com`;
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: "some-long-password",
    });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("rejects admin-created users that are not allow-listed too", async () => {
    const { error } = await adminClient().auth.admin.createUser({
      email: `admin-stranger-${Date.now()}@example.com`,
      password: "some-long-password",
      email_confirm: true,
    });
    expect(error).not.toBeNull();
  });

  it("allows allow-listed emails", async () => {
    await ensureUser(E2E_USER);
    const { data, error } = await anonClient().auth.signInWithPassword(E2E_USER);
    expect(error).toBeNull();
    expect(data.user?.email).toBe(E2E_USER.email);
  });
});

describe("error_logs RLS", () => {
  it("anonymous clients cannot read or write error logs", async () => {
    const anon = anonClient();
    const insert = await anon.from("error_logs").insert({ source: "test", message: "x" });
    expect(insert.error).not.toBeNull();
    const read = await anon.from("error_logs").select("id");
    expect(read.data ?? []).toHaveLength(0);
  });

  it("a second user cannot read my error logs", async () => {
    await ensureUser(E2E_USER);
    await ensureUser(INTRUDER_USER);

    const me = anonClient();
    await me.auth.signInWithPassword(E2E_USER);
    const marker = `rls-${Date.now()}`;
    const mine = await me.from("error_logs").insert({ source: "test", message: marker });
    expect(mine.error).toBeNull();

    const intruder = anonClient();
    await intruder.auth.signInWithPassword(INTRUDER_USER);
    const seen = await intruder.from("error_logs").select("id").eq("message", marker);
    expect(seen.error).toBeNull();
    expect(seen.data).toHaveLength(0);

    const own = await me.from("error_logs").select("id").eq("message", marker);
    expect(own.data).toHaveLength(1);
  });
});
