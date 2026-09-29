/** Every user table included in exports and backups (all rows, soft-deleted too). */
export const EXPORT_TABLES = [
  "user_settings",
  "instruments",
  "trading_days",
  "playbooks",
  "playbook_versions",
  "playbook_checklist_items",
  "session_preps",
  "key_levels",
  "scenarios",
  "calendar_events",
  "calendar_templates",
  "holidays",
  "trades",
  "fills",
  "tag_groups",
  "tags",
  "trade_tags",
  "media",
  "debriefs",
  "rules",
  "rule_checks",
  "action_items",
  "weekly_reviews",
  "saved_views",
  "ai_requests",
  "ai_insights",
  "import_presets",
  "briefs",
  "statements",
  "statement_products",
  "statement_fills",
  "statement_code_map",
  "api_tokens",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Columns never exported. */
export const EXCLUDED_COLUMNS: Partial<Record<ExportTable, string[]>> = {
  api_tokens: ["token_hash"],
};

export const EXPORT_VERSION = 1;
