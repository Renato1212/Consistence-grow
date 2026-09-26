import type { DomainCode } from "@/lib/domains";

/** Playbook editor model; saved by the `save_playbook` RPC (fields + checklist + version). */
export const PLAYBOOK_STATUSES = ["idea", "testing", "active", "retired"] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];
export const STATUS_LABEL: Record<PlaybookStatus, string> = {
  idea: "Idea",
  testing: "Testing",
  active: "Active",
  retired: "Retired",
};

export const TEXT_SECTIONS = [
  {
    key: "contextMd",
    column: "context_md",
    label: "Context",
    hint: "When is this playbook valid? Regime, day type, event conditions, time windows.",
  },
  {
    key: "edgeMd",
    column: "edge_md",
    label: "Edge",
    hint: "Why it works — the participant / imbalance logic.",
  },
  {
    key: "triggerMd",
    column: "trigger_md",
    label: "Trigger & entry",
    hint: "What exactly gets me in.",
  },
  {
    key: "stopMd",
    column: "stop_md",
    label: "Stop / invalidation",
    hint: "Where the idea is wrong.",
  },
  {
    key: "targetsMd",
    column: "targets_md",
    label: "Targets & management",
    hint: "Where I take profits, how I manage.",
  },
  { key: "avoidMd", column: "avoid_md", label: "Do NOT trade when…", hint: "Filters." },
] as const;

export type TextKey = (typeof TEXT_SECTIONS)[number]["key"];

export type ChecklistDraft = { id: string; text: string };

export type PlaybookSnapshot = {
  id: string;
  name: string;
  primaryDomain: DomainCode;
  secondaryDomains: DomainCode[];
  markets: string[];
  status: PlaybookStatus;
  summary: string;
  contextMd: string;
  edgeMd: string;
  triggerMd: string;
  stopMd: string;
  targetsMd: string;
  avoidMd: string;
  notesMd: string;
  checklist: ChecklistDraft[];
};

export function emptyPlaybook(id: string, domain: DomainCode): PlaybookSnapshot {
  return {
    id,
    name: "",
    primaryDomain: domain,
    secondaryDomains: [],
    markets: [],
    status: "idea",
    summary: "",
    contextMd: "",
    edgeMd: "",
    triggerMd: "",
    stopMd: "",
    targetsMd: "",
    avoidMd: "",
    notesMd: "",
    checklist: [],
  };
}

export function canSavePlaybook(s: PlaybookSnapshot) {
  return s.name.trim().length > 0;
}

export function toPlaybookPayload(s: PlaybookSnapshot): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name.trim(),
    primary_domain: s.primaryDomain,
    secondary_domains: s.secondaryDomains.filter((d) => d !== s.primaryDomain),
    markets: s.markets,
    status: s.status,
    summary: s.summary.trim(),
    context_md: s.contextMd,
    edge_md: s.edgeMd,
    trigger_md: s.triggerMd,
    stop_md: s.stopMd,
    targets_md: s.targetsMd,
    avoid_md: s.avoidMd,
    notes_md: s.notesMd,
    checklist: s.checklist.map((c) => ({ id: c.id, text: c.text.trim() })),
  };
}

export type PlaybookRow = {
  id: string;
  name: string;
  primary_domain: string;
  secondary_domains: string[];
  markets: string[];
  status: string;
  summary: string | null;
  context_md: string | null;
  edge_md: string | null;
  trigger_md: string | null;
  stop_md: string | null;
  targets_md: string | null;
  avoid_md: string | null;
  notes_md: string | null;
};

export function playbookRowToSnapshot(
  r: PlaybookRow,
  checklist: ChecklistDraft[],
): PlaybookSnapshot {
  return {
    id: r.id,
    name: r.name,
    primaryDomain: r.primary_domain as DomainCode,
    secondaryDomains: (r.secondary_domains ?? []) as DomainCode[],
    markets: r.markets ?? [],
    status: r.status as PlaybookStatus,
    summary: r.summary ?? "",
    contextMd: r.context_md ?? "",
    edgeMd: r.edge_md ?? "",
    triggerMd: r.trigger_md ?? "",
    stopMd: r.stop_md ?? "",
    targetsMd: r.targets_md ?? "",
    avoidMd: r.avoid_md ?? "",
    notesMd: r.notes_md ?? "",
    checklist,
  };
}

/** Move item `i` by `dir` within the list (no-op at the ends). */
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
