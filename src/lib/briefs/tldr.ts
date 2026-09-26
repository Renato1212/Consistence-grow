/**
 * Pull the TL;DR bullets (section 0) out of a Macro Desk brief so Today can
 * show them. Tolerant of heading styles: "## 0. TL;DR", "**0. TL;DR**",
 * "0) TLDR". Stops at the next numbered section (1–9).
 */
const SECTION_0 = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*0\s*[.)]\s*TL;?\s*DR\b/i;
// A new section has heading markup ("## 1.", "**1.") or a known section title;
// plain "1. …" lines inside the TL;DR are numbered bullets, not sections.
const NEXT_SECTION_MARKED = /^\s*(?:#{1,6}\s*|\*\*|__)\s*[1-9]\s*[.)]\s/;
const NEXT_SECTION_NAMED =
  /^\s*[1-9]\s*[.)]\s*(?:Overnight|Market environment|Dominant|Catalyst|Scenario|Directional|Best instruments|Risk flags|What would)/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

export function extractTldr(markdown: string, max = 6): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION_0.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (NEXT_SECTION_MARKED.test(line) || NEXT_SECTION_NAMED.test(line)) break;
    const m = BULLET.exec(line);
    if (m && m[1].trim()) out.push(m[1].trim());
    if (out.length >= max) break;
  }
  return out;
}

/** "EU" | "US" from loose input ("eu", "European-open", "us-session"…). */
export function parseEdition(raw: unknown): "EU" | "US" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "eu" || s.startsWith("eu") || s.startsWith("europe")) return "EU";
  if (s === "us" || s.startsWith("us")) return "US";
  return null;
}
