import { describe, expect, it } from "vitest";

import { generateToken, hashToken, tokenPrefix } from "./token";
import { extractTldr, parseEdition } from "./tldr";

const BRIEF = `# Pre-Session Brief — European-open edition
Data as of 07:12 Lisbon

## 0. TL;DR
- **Regime:** risk-on drift, yields steady
- Key events: CPI 13:30 Lisbon
* Bias: ES two-sided, low conviction
- In focus: ES, ZN · Avoid: 6J
- Main risk: hot CPI

## 1. Overnight & recent moves
- ES +0.3%
`;

describe("TL;DR extraction", () => {
  it("takes section 0 bullets and stops at section 1", () => {
    expect(extractTldr(BRIEF)).toEqual([
      "**Regime:** risk-on drift, yields steady",
      "Key events: CPI 13:30 Lisbon",
      "Bias: ES two-sided, low conviction",
      "In focus: ES, ZN · Avoid: 6J",
      "Main risk: hot CPI",
    ]);
  });

  it("accepts bold headings and caps the count", () => {
    const md = "**0. TL;DR**\n1. a\n2. b\n3. c\n**1. Overnight**\n- x";
    expect(extractTldr(md)).toEqual(["a", "b", "c"]);
    expect(extractTldr(md, 2)).toEqual(["a", "b"]);
  });

  it("returns nothing without a section 0", () => {
    expect(extractTldr("# Brief\n- just bullets")).toEqual([]);
  });
});

describe("editions", () => {
  it("parses loose edition names", () => {
    expect(parseEdition("eu")).toBe("EU");
    expect(parseEdition("European-open")).toBe("EU");
    expect(parseEdition("US")).toBe("US");
    expect(parseEdition("us-session refresh")).toBe("US");
    expect(parseEdition("asia")).toBeNull();
    expect(parseEdition(3)).toBeNull();
  });
});

describe("tokens", () => {
  it("generates long random tokens and hashes them as hex SHA-256", async () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^cg_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(tokenPrefix(a)).toBe(`${a.slice(0, 7)}…`);
  });
});
