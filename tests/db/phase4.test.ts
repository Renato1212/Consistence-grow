import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { E2E_USER, INTRUDER_USER, localSql, signedIn } from "../local-supabase";

const sql = localSql();
afterAll(() => sql.end());

let me: { client: SupabaseClient; userId: string };
let intruder: { client: SupabaseClient; userId: string };
let esId: string;
let ruleId: string;

beforeAll(async () => {
  me = await signedIn(E2E_USER);
  intruder = await signedIn(INTRUDER_USER);
  esId = (await me.client.from("instruments").select("id").eq("symbol", "ES").single()).data!.id;
  ruleId = (await me.client.from("rules").select("id").limit(1).single()).data!.id;
});

function uniqueDate() {
  const d = new Date(Date.UTC(2041, 0, 1) + Math.floor(Math.random() * 5000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A prep on `date` with one scenario and one level; returns their ids. */
async function prepWith(date: string) {
  const scenario = randomUUID();
  const level = randomUUID();
  const { error } = await me.client.rpc("save_prep", {
    p: {
      id: randomUUID(),
      date,
      session: "US",
      levels: [{ id: level, instrument_id: esId, price_low: 5000, level_type: "PDH", strength: 3 }],
      scenarios: [{ id: scenario, instrument_id: esId, if_text: "if", then_text: "then" }],
    },
  });
  expect(error).toBeNull();
  return { scenario, level };
}

describe("save_debrief", () => {
  it("saves grades, plan vs reality, rule checks and action items in one call", async () => {
    const date = uniqueDate();
    const { scenario, level } = await prepWith(date);
    const id = randomUUID();
    const action = randomUUID();
    const payload = {
      id,
      date,
      grade_context: "A",
      grade_edge: "B",
      grade_process: "C",
      went_well: ["patience", "sizing"],
      to_improve: ["exits"],
      lesson: "Wait for the retest",
      mood: 4,
      scenarios: [{ id: scenario, outcome: "partial", traded: true }],
      levels: [{ id: level, tested: true, respected: false }],
      rule_checks: [{ rule_id: ruleId, followed: false, note: "Held through CPI" }],
      action_items: [{ id: action, text: "Flatten 2 min before data", show_in_prep: true }],
      completed_at: new Date().toISOString(),
    };
    const first = await me.client.rpc("save_debrief", { p: payload });
    expect(first.error).toBeNull();
    expect(first.data).toBe(id);
    expect((await me.client.rpc("save_debrief", { p: payload })).error).toBeNull(); // idempotent

    const [row] = await sql`
      select d.grade_process, d.went_well, d.completed_at is not null as done,
             (select outcome from public.scenarios where id = ${scenario}) as outcome,
             (select traded from public.scenarios where id = ${scenario}) as traded,
             (select respected from public.key_levels where id = ${level}) as respected,
             (select note from public.rule_checks where day_id = d.day_id and context = 'debrief' and rule_id = ${ruleId}) as note,
             (select count(*)::int from public.action_items where source_id = d.id and deleted_at is null) as actions
        from public.debriefs d where d.id = ${id}`;
    expect(row).toMatchObject({
      grade_process: "C",
      went_well: ["patience", "sizing"],
      done: true,
      outcome: "partial",
      traded: true,
      respected: false,
      note: "Held through CPI",
      actions: 1,
    });

    // Removing the action item soft-deletes it; marking done stamps closed_at.
    const second = await me.client.rpc("save_debrief", { p: { ...payload, action_items: [] } });
    expect(second.error).toBeNull();
    const [gone] =
      await sql`select deleted_at is not null as deleted from public.action_items where id = ${action}`;
    expect(gone.deleted).toBe(true);
  });

  it("refuses to complete without grades or with an unexplained broken rule", async () => {
    const date = uniqueDate();
    const base = { id: randomUUID(), date, completed_at: new Date().toISOString() };
    const noGrades = await me.client.rpc("save_debrief", { p: base });
    expect(noGrades.error?.message).toMatch(/grade/);
    const noNote = await me.client.rpc("save_debrief", {
      p: {
        ...base,
        grade_context: "A",
        grade_edge: "A",
        grade_process: "A",
        rule_checks: [{ rule_id: ruleId, followed: false, note: " " }],
      },
    });
    expect(noNote.error?.message).toMatch(/broken rule/);
    // A draft (not completed) saves fine without grades.
    expect((await me.client.rpc("save_debrief", { p: { id: base.id, date } })).error).toBeNull();
  });

  it("only touches scenarios of its own day; a second id for the same day reuses the debrief", async () => {
    const dayA = uniqueDate();
    const dayB = uniqueDate();
    const other = await prepWith(dayB);
    const id = randomUUID();
    await me.client.rpc("save_debrief", {
      p: { id, date: dayA, scenarios: [{ id: other.scenario, outcome: "played", traded: true }] },
    });
    const [s] = await sql`select outcome from public.scenarios where id = ${other.scenario}`;
    expect(s.outcome).toBeNull();

    const again = await me.client.rpc("save_debrief", {
      p: { id: randomUUID(), date: dayA, lesson: "x" },
    });
    expect(again.data).toBe(id);
  });

  it("another user cannot write into my debrief or my scenarios", async () => {
    const date = uniqueDate();
    const { scenario } = await prepWith(date);
    const id = randomUUID();
    await me.client.rpc("save_debrief", { p: { id, date, lesson: "mine" } });
    await intruder.client.rpc("save_debrief", {
      p: { id, date, lesson: "hacked", scenarios: [{ id: scenario, outcome: "didnt" }] },
    });
    const [row] = await sql`select lesson from public.debriefs where id = ${id}`;
    expect(row.lesson).toBe("mine");
    const [s] = await sql`select outcome from public.scenarios where id = ${scenario}`;
    expect(s.outcome).toBeNull();
  });
});

describe("weekly reviews", () => {
  it("upsert by (user, iso week), max 3 goals, private", async () => {
    const week = 1 + Math.floor(Math.random() * 52);
    const year = 2050 + Math.floor(Math.random() * 40);
    const up = await me.client
      .from("weekly_reviews")
      .upsert(
        { iso_year: year, iso_week: week, reflection: "ok", goals: ["a", "b"] },
        { onConflict: "user_id,iso_year,iso_week" },
      )
      .select("id")
      .single();
    expect(up.error).toBeNull();
    const again = await me.client
      .from("weekly_reviews")
      .upsert(
        { iso_year: year, iso_week: week, reflection: "better", goals: ["a"] },
        { onConflict: "user_id,iso_year,iso_week" },
      )
      .select("id")
      .single();
    expect(again.data!.id).toBe(up.data!.id);
    const tooMany = await me.client
      .from("weekly_reviews")
      .upsert(
        { iso_year: year, iso_week: week, goals: ["1", "2", "3", "4"] },
        { onConflict: "user_id,iso_year,iso_week" },
      );
    expect(tooMany.error).not.toBeNull();
    const theirs = await intruder.client.from("weekly_reviews").select("id").eq("id", up.data!.id);
    expect(theirs.data).toHaveLength(0);
  });
});
