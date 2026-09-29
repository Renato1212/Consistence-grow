import { describe, expect, it } from "vitest";

import { RESTORE_CHUNK, planRestore } from "./restore";

describe("planRestore", () => {
  it("orders tables parent-first, chunks big tables and skips API tokens", () => {
    const trades = Array.from({ length: RESTORE_CHUNK + 1 }, (_, i) => ({ id: String(i) }));
    const plan = planRestore(
      JSON.stringify({
        version: 1,
        exported_at: "2026-09-29T10:00:00Z",
        tables: {
          fills: [{ id: "f" }],
          trades,
          instruments: [{ id: "i" }],
          api_tokens: [{ id: "t" }],
          nonsense: [{ id: "x" }],
        },
      }),
    );
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.steps.map((s) => [s.table, s.rows.length])).toEqual([
      ["instruments", 1],
      ["trades", RESTORE_CHUNK],
      ["trades", 1],
      ["fills", 1],
    ]);
    expect(plan.total).toBe(RESTORE_CHUNK + 3);
    expect(plan.exportedAt).toBe("2026-09-29T10:00:00Z");
  });

  it("rejects files that are not backups", () => {
    expect(planRestore("nope")).toMatchObject({ ok: false });
    expect(planRestore(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false });
  });
});
