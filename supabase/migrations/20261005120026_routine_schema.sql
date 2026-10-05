-- Daily routine: the trader's blocks (prep / trade / debrief) live in
-- user_settings.routine (validated in TypeScript, src/lib/routine). Each day's
-- ticks, bias check, EU "no qualifying event" confirmation and the 2-minute
-- debrief per block are stored in routine_days. Four setup playbooks are
-- seeded (marked in notes_json.routine_setup so renames keep the link).

alter table public.user_settings add column routine jsonb
  check (routine is null or jsonb_typeof(routine) = 'object');

-- Per-instrument bias of the 60-second prep: {instrument_id: long|short|neutral}.
alter table public.session_preps add column instrument_bias jsonb not null default '{}'::jsonb
  check (jsonb_typeof(instrument_bias) = 'object');

-- Weekly scorecard notes per setup: {playbook_id: {verdict: keep|tweak|drop, note}}.
alter table public.weekly_reviews add column setup_notes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(setup_notes) = 'object');

create table public.routine_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  date date not null,
  block_key text not null check (block_key ~ '^[a-z0-9_]{1,40}$'),
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  bias jsonb not null default '{}'::jsonb check (jsonb_typeof(bias) = 'object'),
  no_trade boolean not null default false,
  followed text check (followed in ('yes', 'partly', 'no')),
  lesson text check (length(lesson) <= 1000)
);
create unique index routine_days_uidx
  on public.routine_days (user_id, date, block_key) where deleted_at is null;
create index routine_days_user_date_idx on public.routine_days (user_id, date);

alter table public.routine_days enable row level security;
create policy "routine_days: owner" on public.routine_days for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create trigger set_updated_at before update on public.routine_days
  for each row execute function public.set_updated_at();

