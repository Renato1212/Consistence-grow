/** One analytics row per trade (a compact slice of `trade_facts`). */
export type InsightTrade = {
  id: string;
  kind: "taken" | "missed" | "observed";
  trade_date: string | null; // Lisbon date
  entry_at: string;
  /** Last edit (used to recognise when an AI analysis still matches the data). */
  updated_at?: string;
  symbol: string;
  currency: string;
  direction: "long" | "short";
  net_pnl: number | null;
  r_multiple: number | null;
  ticks: number | null;
  duration_sec: number | null;
  session: string | null;
  weekday: number | null; // ISO, exchange time zone
  time_bucket: string | null; // "HH:mm", exchange time zone
  primary_domain: string | null;
  secondary_domains: string[];
  domain_count: number;
  playbook_id: string | null;
  playbook_name: string | null;
  playbook_version: number | null;
  minutes_from_event: number | null;
  event_category: string | null;
  event_title: string | null;
  level_type: string | null;
  level_strength: number | null;
  scenario_id: string | null;
  key_level_id: string | null;
  regime: string | null;
  prior_day_type: string | null;
  prep_done: boolean | null;
  readiness: number | null;
  confidence: number | null;
  grade_context: string | null;
  grade_edge: string | null;
  grade_process: string | null;
  exit_reason: string | null;
  tag_ids: string[];
  tag_names: string[];
};

export type TagInfo = { id: string; name: string; group: string; kind: string };

export type ScenarioFact = {
  id: string;
  date: string;
  session: string;
  instrument: string | null;
  direction: string | null;
  primary_domain: string | null;
  outcome: "played" | "partial" | "didnt" | null;
  traded: boolean | null;
  text: string;
};

export type LevelFact = {
  id: string;
  date: string;
  instrument: string;
  level_type: string;
  strength: number;
  tested: boolean | null;
  respected: boolean | null;
};

export type RuleCheckFact = { date: string; rule: string; followed: boolean | null };

export type PlaybookRef = { id: string; name: string; version: number };
