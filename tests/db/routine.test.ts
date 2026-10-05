import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { E2E_USER, INTRUDER_USER, signedIn } from "../local-supabase";

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };

function randomDay() {
  for (;;) {
    const d = new Date(Date.UTC(2050, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
  }
}

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
});

describe("routine setups", () => {
  it("seeds the four setup playbooks with checklists and a first version", async () => {
    const r = await me.client
      .from("playbooks")
      .select("id, name, status, notes_json, version")
      .is("deleted_at", null)
      .not("notes_json->>routine_setup", "is", null);
    expect(r.error).toBeNull();
    const keys = r.data!.map((p) => (p.notes_json as { routine_setup: string }).routine_setup);
    expect(keys.sort()).toEqual(["euNews", "moc", "scalp", "usOpen"]);
    for (const p of r.data!) expect(p.status).toBe("testing");

    const scalp = r.data!.find(
      (p) => (p.notes_json as { routine_setup: string }).routine_setup === "scalp",
    )!;
    const items = await me.client
      .from("playbook_checklist_items")
      .select("text")
      .eq("playbook_id", scalp.id)
      .is("deleted_at", null)
      .order("sort");
    expect(items.data!.map((i) => i.text)).toContain("Trading with the winning side");
    const v = await me.client
      .from("playbook_versions")
      .select("version, snapshot")
      .eq("playbook_id", scalp.id)
      .eq("version", 1)
      .single();
    expect((v.data!.snapshot as { checklist: string[] }).checklist).toHaveLength(
      items.data!.length,
    );
  });

  it("stores the routine in user settings", async () => {
    const before = await me.client.from("user_settings").select("routine").single();
    const r = await me.client
      .from("user_settings")
      .update({ routine: { version: 1, marker: "test" } })
      .eq("user_id", me.userId)
      .select("routine")
      .single();
    expect(r.error).toBeNull();
    expect(r.data!.routine).toMatchObject({ marker: "test" });
    const bad = await me.client
      .from("user_settings")
      .update({ routine: [1, 2] })
      .eq("user_id", me.userId);
    expect(bad.error?.code).toBe("23514");
    await me.client
      .from("user_settings")
      .update({ routine: before.data!.routine })
      .eq("user_id", me.userId);
  });
});

describe("save_routine_day", () => {
  it("merges ticks and bias, and keeps fields the patch leaves out", async () => {
    const day = randomDay();
    const save = (patch: Record<string, unknown>) =>
      me.client.rpc("save_routine_day", { p_date: day, p_block: "us_scalp", p_patch: patch });
    expect((await save({ checks: { a: true } })).error).toBeNull();
    expect((await save({ checks: { b: true }, bias: { side: "long" } })).error).toBeNull();
    expect(
      (await save({ checks: { a: false }, followed: "partly", lesson: " Wait " })).error,
    ).toBeNull();
    expect((await save({ bias: { trend: true } })).error).toBeNull();

    const row = await me.client
      .from("routine_days")
      .select("checks, bias, no_trade, followed, lesson")
      .eq("date", day)
      .eq("block_key", "us_scalp")
      .single();
    expect(row.data).toEqual({
      checks: { a: false, b: true },
      bias: { side: "long", trend: true },
      no_trade: false,
      followed: "partly",
      lesson: "Wait",
    });

    expect((await save({ followed: "" })).error).toBeNull();
    const cleared = await me.client
      .from("routine_days")
      .select("followed, lesson")
      .eq("date", day)
      .eq("block_key", "us_scalp")
      .single();
    expect(cleared.data).toEqual({ followed: null, lesson: "Wait" });

    expect((await save({ followed: "maybe" })).error?.code).toBe("23514");
    const badKey = await me.client.rpc("save_routine_day", {
      p_date: day,
      p_block: "Bad Key",
      p_patch: {},
    });
    expect(badKey.error?.code).toBe("22023");

    const peek = await intruder.client.from("routine_days").select("id").eq("date", day);
    expect(peek.data).toEqual([]);
  });
});

describe("save_quick_prep", () => {
  it("upserts narrative, instruments and bias without touching the rest of the prep", async () => {
    const day = randomDay();
    const inst = await me.client.from("instruments").select("id").limit(2);
    const [a, b] = inst.data!.map((i) => i.id as string);

    const first = await me.client.rpc("save_quick_prep", {
      p_date: day,
      p_session: "US",
      p_narrative: "CPI hot → yields up",
      p_instrument_ids: [a, b],
      p_bias: { [a]: "short", [b]: "neutral" },
    });
    expect(first.error).toBeNull();
    await me.client.from("session_preps").update({ intention: "Patience" }).eq("id", first.data);

    const second = await me.client.rpc("save_quick_prep", {
      p_date: day,
      p_session: "US",
      p_narrative: "CPI hot",
      p_instrument_ids: [a],
      p_bias: { [a]: "long" },
    });
    expect(second.data).toBe(first.data);
    const row = await me.client
      .from("session_preps")
      .select("narrative, focus_instrument_ids, instrument_bias, intention")
      .eq("id", first.data)
      .single();
    expect(row.data).toEqual({
      narrative: "CPI hot",
      focus_instrument_ids: [a],
      instrument_bias: { [a]: "long" },
      intention: "Patience",
    });

    const bad = await me.client.rpc("save_quick_prep", {
      p_date: day,
      p_session: "US",
      p_narrative: "",
      p_instrument_ids: [],
      p_bias: { [a]: "up" },
    });
    expect(bad.error?.code).toBe("22023");
  });
});

describe("save_quick_debrief", () => {
  it("grades the day, records each block and completes only with a grade", async () => {
    const day = randomDay();
    const noGrade = await me.client.rpc("save_quick_debrief", {
      p_date: day,
      p_grade: null,
      p_lesson: "",
      p_blocks: [],
      p_complete: true,
    });
    expect(noGrade.error?.code).toBe("23514");

    const draft = await me.client.rpc("save_quick_debrief", {
      p_date: day,
      p_grade: null,
      p_lesson: "Draft",
      p_blocks: [{ block: "us_open", followed: "yes", lesson: "" }],
      p_complete: false,
    });
    expect(draft.error).toBeNull();
    const done = await me.client.rpc("save_quick_debrief", {
      p_date: day,
      p_grade: "B",
      p_lesson: "Sized down after the loss",
      p_blocks: [
        { block: "us_open", followed: "yes", lesson: "" },
        { block: "us_scalp", followed: "no", lesson: "Faded the trend" },
      ],
      p_complete: true,
    });
    expect(done.error).toBeNull();
    expect(done.data).toBe(draft.data);

    const d = await me.client
      .from("debriefs")
      .select("grade_process, lesson, completed_at")
      .eq("id", done.data)
      .single();
    expect(d.data).toMatchObject({ grade_process: "B", lesson: "Sized down after the loss" });
    expect(d.data!.completed_at).not.toBeNull();

    const rows = await me.client
      .from("routine_days")
      .select("block_key, followed, lesson")
      .eq("date", day)
      .order("block_key");
    expect(rows.data).toEqual([
      { block_key: "us_open", followed: "yes", lesson: null },
      { block_key: "us_scalp", followed: "no", lesson: "Faded the trend" },
    ]);
  });
});
