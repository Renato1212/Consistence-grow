import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/import/csv";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes what needs quoting, writes arrays/objects as JSON and round-trips", () => {
    const rows = [
      { id: "1", note: 'He said "go", then\nwaited', tags: ["a", "b"], r: 1.5, empty: null },
      { id: "2", extra: { x: 1 } },
    ];
    const text = toCsv(rows);
    const back = parseCsv(text);
    expect(back.headers).toEqual(["id", "note", "tags", "r", "empty", "extra"]);
    expect(back.rows[0]).toEqual(["1", 'He said "go", then\nwaited', '["a","b"]', "1.5", "", ""]);
    expect(back.rows[1]).toEqual(["2", "", "", "", "", '{"x":1}']);
    expect(toCsv([])).toBe("");
  });
});
