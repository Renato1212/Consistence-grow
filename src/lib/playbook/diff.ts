/**
 * Version diffs: line-level diff for text fields (LCS), added/removed for
 * lists, before/after for scalars.
 */
export type DiffLine = { type: "same" | "add" | "del"; text: string };

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a ? a.split("\n") : [];
  const y = b ? b.split("\n") : [];
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ type: "same", text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: x[i++] });
    } else {
      out.push({ type: "add", text: y[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: x[i++] });
  while (j < m) out.push({ type: "add", text: y[j++] });
  return out;
}

export type VersionSnapshot = Record<string, unknown>;

export const SNAPSHOT_FIELDS: { key: string; label: string; kind: "text" | "list" | "scalar" }[] = [
  { key: "name", label: "Name", kind: "scalar" },
  { key: "status", label: "Status", kind: "scalar" },
  { key: "primary_domain", label: "Primary domain", kind: "scalar" },
  { key: "secondary_domains", label: "Secondary domains", kind: "list" },
  { key: "markets", label: "Markets", kind: "list" },
  { key: "summary", label: "Summary", kind: "text" },
  { key: "context_md", label: "Context", kind: "text" },
  { key: "edge_md", label: "Edge", kind: "text" },
  { key: "trigger_md", label: "Trigger & entry", kind: "text" },
  { key: "stop_md", label: "Stop / invalidation", kind: "text" },
  { key: "targets_md", label: "Targets & management", kind: "text" },
  { key: "avoid_md", label: "Do NOT trade when…", kind: "text" },
  { key: "checklist", label: "Pre-entry checklist", kind: "list" },
];

export type FieldChange =
  | { key: string; label: string; kind: "scalar"; before: string; after: string }
  | { key: string; label: string; kind: "list"; added: string[]; removed: string[] }
  | { key: string; label: string; kind: "text"; lines: DiffLine[] };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** Changed fields between two version snapshots (unchanged fields omitted). */
export function diffSnapshots(before: VersionSnapshot, after: VersionSnapshot): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of SNAPSHOT_FIELDS) {
    const a = before[f.key];
    const b = after[f.key];
    if (f.kind === "list") {
      const x = arr(a);
      const y = arr(b);
      const added = y.filter((v) => !x.includes(v));
      const removed = x.filter((v) => !y.includes(v));
      const reordered = !added.length && !removed.length && x.join("\n") !== y.join("\n");
      if (added.length || removed.length || reordered)
        out.push({
          key: f.key,
          label: reordered ? `${f.label} (reordered)` : f.label,
          kind: "list",
          added,
          removed,
        });
    } else if (f.kind === "text") {
      if (str(a) !== str(b))
        out.push({ key: f.key, label: f.label, kind: "text", lines: diffLines(str(a), str(b)) });
    } else if (str(a) !== str(b)) {
      out.push({ key: f.key, label: f.label, kind: "scalar", before: str(a), after: str(b) });
    }
  }
  return out;
}
