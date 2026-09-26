import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/journal")).toBe("/journal");
    expect(safeNextPath("/journal?x=1")).toBe("/journal?x=1");
  });

  it("falls back for missing or external destinations", () => {
    expect(safeNextPath(null)).toBe("/today");
    expect(safeNextPath("")).toBe("/today");
    expect(safeNextPath("https://evil.example")).toBe("/today");
    expect(safeNextPath("//evil.example")).toBe("/today");
    expect(safeNextPath("/\\evil.example")).toBe("/today");
  });
});
