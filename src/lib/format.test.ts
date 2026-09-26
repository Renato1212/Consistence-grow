import { describe, expect, it } from "vitest";

import { fmtDuration, fmtMoney, fmtR, fmtTicks, pnlClass } from "./format";

describe("format", () => {
  it("formats R with sign", () => {
    expect(fmtR(1.955)).toBe("+1.96R");
    expect(fmtR(-1)).toBe("−1.00R");
    expect(fmtR(0)).toBe("0.00R");
    expect(fmtR(null)).toBe("—");
  });
  it("formats money with currency", () => {
    expect(fmtMoney(586.5)).toBe("+$586.50");
    expect(fmtMoney(-1234.5)).toBe("−$1,234.50");
    expect(fmtMoney(500, "EUR")).toBe("+€500.00");
  });
  it("formats ticks and durations", () => {
    expect(fmtTicks(16)).toBe("+16t");
    expect(fmtTicks(-2.5)).toBe("−2.5t");
    expect(fmtDuration(45)).toBe("45s");
    expect(fmtDuration(750)).toBe("12m 30s");
    expect(fmtDuration(3900)).toBe("1h 5m");
  });
  it("uses green/red only for non-zero P&L", () => {
    expect(pnlClass(1)).toBe("text-profit");
    expect(pnlClass(-1)).toBe("text-loss");
    expect(pnlClass(0)).toBe("text-muted-foreground");
  });
});
