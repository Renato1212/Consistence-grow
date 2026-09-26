-- Phase 1: core data model. Every table is owned by one user and protected by
-- RLS (user_id = auth.uid()). Soft delete via deleted_at everywhere except
-- pure junction tables.

-- ---------------------------------------------------------------------------
-- instruments
-- ---------------------------------------------------------------------------
create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,10}$'),
  name text not null,
  exchange text not null,
  asset_class text not null check (asset_class in ('equity_index', 'energy', 'metals', 'rates', 'fx', 'crypto', 'other')),
  tick_size numeric not null check (tick_size > 0),
  tick_value numeric not null check (tick_value > 0),
  currency text not null default 'USD' check (currency in ('USD', 'EUR', 'GBP', 'JPY')),
  exchange_tz text not null default 'America/Chicago',
  price_format text not null default 'decimal' check (price_format in ('decimal', 'thirty_seconds')),
  fee_per_contract numeric not null default 0 check (fee_per_contract >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  notes text
);
create unique index instruments_user_symbol_uidx on public.instruments (user_id, symbol) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- user_settings (one row per user)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  display_tz text not null default 'Europe/Lisbon',
  secondary_tz text default 'America/New_York',
  eu_session_start time not null default '07:00',
  eu_session_tz text not null default 'Europe/London',
  us_session_start time not null default '08:00',
  us_session_end time not null default '17:00',
  us_session_tz text not null default 'America/New_York',
  eu_prep_by time not null default '08:00',
  eu_prep_tz text not null default 'Europe/Lisbon',
  us_cash_open time not null default '09:30',
  event_banner_minutes int not null default 10 check (event_banner_minutes between 0 and 120),
  pattern_min_n int not null default 8 check (pattern_min_n between 3 and 100),
  currency_display text not null default 'USD',
  last_instrument_id uuid references public.instruments (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- trading_days
-- ---------------------------------------------------------------------------
create table public.trading_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  unique (user_id, date)
);

-- ---------------------------------------------------------------------------
-- playbooks (+ versions, checklist)
-- ---------------------------------------------------------------------------
create table public.playbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  primary_domain text not null check (primary_domain in ('TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW')),
  secondary_domains text[] not null default '{}' check (secondary_domains <@ array['TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW']::text[]),
  markets text[] not null default '{}',
  status text not null default 'idea' check (status in ('idea', 'testing', 'active', 'retired')),
  summary text,
  context_md text,
  edge_md text,
  trigger_md text,
  stop_md text,
  targets_md text,
  avoid_md text,
  notes_json jsonb,
  version int not null default 1 check (version >= 1)
);

create table public.playbook_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  unique (playbook_id, version)
);

create table public.playbook_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  text text not null,
  sort int not null default 0
);

-- ---------------------------------------------------------------------------
-- session preps, key levels, scenarios
-- ---------------------------------------------------------------------------
create table public.session_preps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  day_id uuid not null references public.trading_days (id) on delete cascade,
  session text not null check (session in ('EU', 'US')),
  sleep smallint check (sleep between 1 and 5),
  energy smallint check (energy between 1 and 5),
  focus smallint check (focus between 1 and 5),
  how_am_i text,
  brief_md text,
  prior_day_type text,
  regime text,
  vol_state text check (vol_state in ('low', 'normal', 'high')),
  narrative text,
  options_notes text,
  focus_instrument_ids uuid[] not null default '{}',
  focus_playbook_ids uuid[] not null default '{}',
  intention text,
  max_loss_usd numeric check (max_loss_usd >= 0),
  max_loss_r numeric check (max_loss_r >= 0),
  max_trades int check (max_trades >= 0),
  max_size numeric check (max_size >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  copied_from_id uuid references public.session_preps (id) on delete set null
);
create unique index session_preps_day_session_uidx on public.session_preps (day_id, session) where deleted_at is null;

create table public.key_levels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  prep_id uuid not null references public.session_preps (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id) on delete restrict,
  price_low numeric not null,
  price_high numeric,
  level_type text not null,
  strength smallint not null default 2 check (strength between 1 and 3),
  note text,
  tested boolean,
  respected boolean,
  carried_from_id uuid references public.key_levels (id) on delete set null,
  sort int not null default 0,
  check (price_high is null or price_high >= price_low)
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  prep_id uuid not null references public.session_preps (id) on delete cascade,
  instrument_id uuid references public.instruments (id) on delete restrict,
  direction text check (direction in ('long', 'short')),
  if_text text not null default '',
  then_text text not null default '',
  playbook_id uuid references public.playbooks (id) on delete set null,
  primary_domain text check (primary_domain in ('TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW')),
  outcome text check (outcome in ('played', 'partial', 'didnt')),
  traded boolean,
  sort int not null default 0
);

-- ---------------------------------------------------------------------------
-- calendar events
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  starts_at timestamptz not null,
  native_tz text not null default 'America/New_York',
  primary_domain text not null check (primary_domain in ('TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW')),
  secondary_domains text[] not null default '{}' check (secondary_domains <@ array['TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW']::text[]),
  category text not null,
  title text not null,
  importance smallint not null default 2 check (importance between 1 and 3),
  instruments text[] not null default '{}',
  forecast text,
  previous text,
  actual text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'preset', 'generated', 'headline', 'import')),
  generator_key text
);
create unique index calendar_events_generator_uidx on public.calendar_events (user_id, generator_key) where generator_key is not null;
create index calendar_events_user_starts_idx on public.calendar_events (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  day_id uuid references public.trading_days (id) on delete set null,
  kind text not null default 'taken' check (kind in ('taken', 'missed', 'observed')),
  instrument_id uuid not null references public.instruments (id) on delete restrict,
  direction text not null check (direction in ('long', 'short')),
  entry_at timestamptz not null,
  exit_at timestamptz,
  entry_price numeric not null,
  exit_price numeric,
  stop_price numeric,
  target_price numeric,
  planned_r numeric,
  contracts numeric check (contracts > 0),
  fees numeric check (fees >= 0),
  -- computed by trigger (never typed)
  ticks numeric,
  gross_pnl numeric,
  net_pnl numeric,
  risk_usd numeric,
  r_multiple numeric,
  no_stop boolean not null default true,
  duration_sec int,
  weekday smallint,
  time_bucket text,
  session text check (session in ('ASIA', 'EU', 'US')),
  -- details
  mae_ticks numeric,
  mfe_ticks numeric,
  primary_domain text check (primary_domain in ('TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW')),
  secondary_domains text[] not null default '{}' check (secondary_domains <@ array['TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW']::text[]),
  playbook_id uuid references public.playbooks (id) on delete set null,
  playbook_version int,
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  minutes_from_event int,
  scenario_id uuid references public.scenarios (id) on delete set null,
  key_level_id uuid references public.key_levels (id) on delete set null,
  entry_type text check (entry_type in ('limit', 'market', 'stop')),
  exit_reason text check (exit_reason in ('target', 'stop', 'trail', 'discretionary', 'time', 'news_flatten')),
  confidence smallint check (confidence between 1 and 5),
  grade_context text check (grade_context in ('A', 'B', 'C', 'F')),
  grade_context_reason text,
  grade_edge text check (grade_edge in ('A', 'B', 'C', 'F')),
  grade_edge_reason text,
  grade_process text check (grade_process in ('A', 'B', 'C', 'F')),
  grade_process_reason text,
  thesis text,
  management text,
  lesson text,
  move_trigger text,
  move_phases text,
  needs_review boolean not null default false,
  import_hash text,
  check (exit_at is null or exit_at >= entry_at),
  check (kind = 'observed' or contracts is not null)
);
create index trades_user_entry_idx on public.trades (user_id, entry_at desc);
create index trades_primary_domain_idx on public.trades (user_id, primary_domain);
create index trades_playbook_idx on public.trades (playbook_id);
create index trades_instrument_idx on public.trades (instrument_id);
create index trades_day_idx on public.trades (day_id);
create unique index trades_import_hash_uidx on public.trades (user_id, import_hash) where import_hash is not null;

create table public.fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  trade_id uuid references public.trades (id) on delete cascade,
  executed_at timestamptz not null,
  account text,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  price numeric not null,
  qty numeric not null check (qty > 0),
  raw jsonb not null default '{}'::jsonb,
  hash text not null,
  unique (user_id, hash)
);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
create table public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  kind text not null default 'custom' check (kind in ('context', 'detail', 'mistake', 'emotion', 'custom')),
  color text,
  sort int not null default 0
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  group_id uuid not null references public.tag_groups (id) on delete cascade,
  name text not null,
  color text,
  sort int not null default 0
);
create unique index tags_group_name_uidx on public.tags (group_id, lower(name)) where deleted_at is null;

create table public.trade_tags (
  trade_id uuid not null references public.trades (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trade_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- media
-- ---------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  owner_type text not null check (owner_type in ('trade', 'prep', 'debrief', 'playbook', 'event', 'weekly')),
  owner_id uuid not null,
  kind text not null check (kind in ('image', 'video', 'link')),
  storage_path text,
  url text,
  caption text,
  mime text,
  width int,
  height int,
  duration_sec numeric,
  size_bytes bigint,
  sort int not null default 0,
  check ((kind = 'link' and url is not null) or (kind <> 'link' and storage_path is not null))
);
create index media_owner_idx on public.media (user_id, owner_type, owner_id);

-- ---------------------------------------------------------------------------
-- debriefs, rules, action items, weekly reviews
-- ---------------------------------------------------------------------------
create table public.debriefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  day_id uuid not null unique references public.trading_days (id) on delete cascade,
  grade_context text check (grade_context in ('A', 'B', 'C', 'F')),
  grade_context_note text,
  grade_edge text check (grade_edge in ('A', 'B', 'C', 'F')),
  grade_edge_note text,
  grade_process text check (grade_process in ('A', 'B', 'C', 'F')),
  grade_process_note text,
  went_well text[] not null default '{}' check (cardinality(went_well) <= 3),
  to_improve text[] not null default '{}' check (cardinality(to_improve) <= 3),
  lesson text,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  completed_at timestamptz
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  text text not null,
  category text not null default 'general',
  active boolean not null default true,
  sort int not null default 0
);

create table public.rule_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rule_id uuid not null references public.rules (id) on delete cascade,
  day_id uuid not null references public.trading_days (id) on delete cascade,
  prep_id uuid references public.session_preps (id) on delete cascade,
  context text not null check (context in ('prep', 'debrief')),
  followed boolean,
  note text,
  check ((context = 'prep') = (prep_id is not null))
);
create unique index rule_checks_prep_uidx on public.rule_checks (rule_id, prep_id) where prep_id is not null and deleted_at is null;
create unique index rule_checks_debrief_uidx on public.rule_checks (rule_id, day_id) where context = 'debrief' and deleted_at is null;

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  source text not null default 'manual' check (source in ('debrief', 'weekly', 'ai', 'manual')),
  source_id uuid,
  text text not null,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  show_in_prep boolean not null default true,
  due_date date,
  closed_at timestamptz
);
create index action_items_open_idx on public.action_items (user_id, status) where deleted_at is null;

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  iso_year int not null,
  iso_week int not null check (iso_week between 1 and 53),
  reflection text,
  goals text[] not null default '{}' check (cardinality(goals) <= 3),
  unique (user_id, iso_year, iso_week)
);

-- ---------------------------------------------------------------------------
-- insights support
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  filter jsonb not null default '{}'::jsonb
);

create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  scope text not null check (scope in ('filter', 'weekly')),
  filter jsonb not null default '{}'::jsonb,
  data_hash text not null,
  model text not null,
  output jsonb not null,
  input_tokens int,
  output_tokens int,
  cost_estimate numeric
);
create index ai_insights_hash_idx on public.ai_insights (user_id, data_hash);

create table public.import_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  mapping jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- RLS, updated_at triggers and user_id / FK indexes for every table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'instruments', 'user_settings', 'trading_days', 'playbooks', 'playbook_versions',
    'playbook_checklist_items', 'session_preps', 'key_levels', 'scenarios', 'calendar_events',
    'trades', 'fills', 'tag_groups', 'tags', 'trade_tags', 'media', 'debriefs', 'rules',
    'rule_checks', 'action_items', 'weekly_reviews', 'saved_views', 'ai_insights', 'import_presets'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%1$s: owner" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    if t <> 'trade_tags' then
      execute format(
        'create trigger set_updated_at before update on public.%I
           for each row execute function public.set_updated_at()', t);
    end if;
    if t not in ('user_settings', 'trading_days', 'weekly_reviews', 'fills', 'instruments') then
      execute format('create index %1$s_user_idx on public.%1$I (user_id)', t);
    end if;
  end loop;
end $$;

-- Foreign-key indexes not covered above.
create index user_settings_last_instrument_idx on public.user_settings (last_instrument_id);
create index playbook_versions_playbook_idx on public.playbook_versions (playbook_id);
create index playbook_checklist_items_playbook_idx on public.playbook_checklist_items (playbook_id);
create index session_preps_day_idx on public.session_preps (day_id);
create index session_preps_copied_from_idx on public.session_preps (copied_from_id);
create index key_levels_prep_idx on public.key_levels (prep_id);
create index key_levels_instrument_idx on public.key_levels (instrument_id);
create index key_levels_carried_from_idx on public.key_levels (carried_from_id);
create index scenarios_prep_idx on public.scenarios (prep_id);
create index scenarios_instrument_idx on public.scenarios (instrument_id);
create index scenarios_playbook_idx on public.scenarios (playbook_id);
create index trades_calendar_event_idx on public.trades (calendar_event_id);
create index trades_scenario_idx on public.trades (scenario_id);
create index trades_key_level_idx on public.trades (key_level_id);
create index fills_trade_idx on public.fills (trade_id);
create index tags_group_idx on public.tags (group_id);
create index trade_tags_tag_idx on public.trade_tags (tag_id);
create index rule_checks_rule_idx on public.rule_checks (rule_id);
create index rule_checks_day_idx on public.rule_checks (day_id);
create index rule_checks_prep_idx on public.rule_checks (prep_id);
