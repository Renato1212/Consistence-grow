-- Phase 3: calendar (holidays, recurring templates, generated FLOW events)
-- and session preparation (transactional snapshot save).

-- ---------------------------------------------------------------------------
-- Exchange holidays (editable; seeded per user, needs a yearly review)
-- ---------------------------------------------------------------------------
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  date date not null,
  market text not null check (market in ('US', 'UK')),
  name text not null,
  -- null = closed all day; otherwise the early close in the market's own zone
  early_close time
);
create unique index holidays_user_market_date_uidx
  on public.holidays (user_id, market, date) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Recurring calendar templates (weekly releases), off until switched on
-- ---------------------------------------------------------------------------
create table public.calendar_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  preset_key text,
  title text not null,
  category text not null,
  primary_domain text not null check (primary_domain in ('TECHNICAL', 'DATA', 'NEWS', 'CENTRAL_BANKS', 'FLOW')),
  importance smallint not null default 2 check (importance between 1 and 3),
  instruments text[] not null default '{}',
  weekday smallint not null check (weekday between 1 and 5), -- ISO weekday in `tz`
  local_time time not null,
  tz text not null default 'America/New_York',
  active boolean not null default false,
  sort int not null default 0
);

do $$
declare
  t text;
begin
  foreach t in array array['holidays', 'calendar_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%1$s: owner" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('create index %1$s_user_idx on public.%1$I (user_id)', t);
  end loop;
end $$;

-- Calendar reads are by time window; generated rows by key.
create index calendar_events_generated_idx
  on public.calendar_events (user_id, starts_at) where generator_key is not null;

-- ---------------------------------------------------------------------------
-- Defaults: holidays 2026–2027 (NYSE + England & Wales bank holidays) and the
-- weekly release templates. Mirrors src/lib/calendar/holidays.ts and
-- src/lib/calendar/presets.ts (a DB test keeps them identical).
-- ---------------------------------------------------------------------------
create or replace function private.seed_phase3_defaults(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.holidays where user_id = p_user) then
    insert into public.holidays (user_id, market, date, name, early_close) values
      -- NYSE 2026
      (p_user, 'US', '2026-01-01', 'New Year''s Day', null),
      (p_user, 'US', '2026-01-19', 'Martin Luther King Jr. Day', null),
      (p_user, 'US', '2026-02-16', 'Washington''s Birthday', null),
      (p_user, 'US', '2026-04-03', 'Good Friday', null),
      (p_user, 'US', '2026-05-25', 'Memorial Day', null),
      (p_user, 'US', '2026-06-19', 'Juneteenth', null),
      (p_user, 'US', '2026-07-03', 'Independence Day (observed)', null),
      (p_user, 'US', '2026-09-07', 'Labor Day', null),
      (p_user, 'US', '2026-11-26', 'Thanksgiving Day', null),
      (p_user, 'US', '2026-11-27', 'Day after Thanksgiving', '13:00'),
      (p_user, 'US', '2026-12-24', 'Christmas Eve', '13:00'),
      (p_user, 'US', '2026-12-25', 'Christmas Day', null),
      -- NYSE 2027
      (p_user, 'US', '2027-01-01', 'New Year''s Day', null),
      (p_user, 'US', '2027-01-18', 'Martin Luther King Jr. Day', null),
      (p_user, 'US', '2027-02-15', 'Washington''s Birthday', null),
      (p_user, 'US', '2027-03-26', 'Good Friday', null),
      (p_user, 'US', '2027-05-31', 'Memorial Day', null),
      (p_user, 'US', '2027-06-18', 'Juneteenth (observed)', null),
      (p_user, 'US', '2027-07-05', 'Independence Day (observed)', null),
      (p_user, 'US', '2027-09-06', 'Labor Day', null),
      (p_user, 'US', '2027-11-25', 'Thanksgiving Day', null),
      (p_user, 'US', '2027-11-26', 'Day after Thanksgiving', '13:00'),
      (p_user, 'US', '2027-12-24', 'Christmas Day (observed)', null),
      -- England & Wales bank holidays 2026
      (p_user, 'UK', '2026-01-01', 'New Year''s Day', null),
      (p_user, 'UK', '2026-04-03', 'Good Friday', null),
      (p_user, 'UK', '2026-04-06', 'Easter Monday', null),
      (p_user, 'UK', '2026-05-04', 'Early May bank holiday', null),
      (p_user, 'UK', '2026-05-25', 'Spring bank holiday', null),
      (p_user, 'UK', '2026-08-31', 'Summer bank holiday', null),
      (p_user, 'UK', '2026-12-25', 'Christmas Day', null),
      (p_user, 'UK', '2026-12-28', 'Boxing Day (substitute)', null),
      -- England & Wales bank holidays 2027
      (p_user, 'UK', '2027-01-01', 'New Year''s Day', null),
      (p_user, 'UK', '2027-03-26', 'Good Friday', null),
      (p_user, 'UK', '2027-03-29', 'Easter Monday', null),
      (p_user, 'UK', '2027-05-03', 'Early May bank holiday', null),
      (p_user, 'UK', '2027-05-31', 'Spring bank holiday', null),
      (p_user, 'UK', '2027-08-30', 'Summer bank holiday', null),
      (p_user, 'UK', '2027-12-27', 'Christmas Day (substitute)', null),
      (p_user, 'UK', '2027-12-28', 'Boxing Day (substitute)', null);
  end if;

  if not exists (select 1 from public.calendar_templates where user_id = p_user) then
    insert into public.calendar_templates
      (user_id, preset_key, title, category, primary_domain, importance, instruments, weekday, local_time, tz, sort)
    values
      (p_user, 'api', 'API crude inventories', 'Energy inventories', 'DATA', 1, '{CL}', 2, '16:30', 'America/New_York', 10),
      (p_user, 'eia', 'EIA crude inventories', 'Energy inventories', 'DATA', 2, '{CL}', 3, '10:30', 'America/New_York', 20),
      (p_user, 'claims', 'Initial jobless claims', 'Labour', 'DATA', 2, '{ES,NQ,ZN,6E}', 4, '08:30', 'America/New_York', 30),
      (p_user, 'natgas', 'Nat gas storage (EIA)', 'Energy inventories', 'DATA', 2, '{NG}', 4, '10:30', 'America/New_York', 40);
  end if;
end;
$$;

revoke all on function private.seed_phase3_defaults(uuid) from public, anon, authenticated;

create or replace function private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_phase3_defaults(new.id);
  return new;
end;
$$;

select private.seed_phase3_defaults(id) from auth.users;

-- ---------------------------------------------------------------------------
-- RPCs (security invoker: RLS applies exactly as for direct table access)
-- ---------------------------------------------------------------------------

-- Idempotently get the trading day row for a Lisbon date.
create or replace function public.ensure_trading_day(p_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.trading_days (date) values (p_date)
  on conflict (user_id, date) do nothing;
  select d.id into v_id from public.trading_days d
   where d.user_id = (select auth.uid()) and d.date = p_date;
  return v_id;
end;
$$;

-- Save a whole session prep (prep + key levels + scenarios + rule checks) in
-- one transaction. Idempotent: ids are generated by the client; rows missing
-- from the snapshot are soft-deleted. Debrief-owned fields (level tested /
-- respected, scenario outcome / traded) are never touched here.
create or replace function public.save_prep(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prep uuid := (p ->> 'id')::uuid;
  v_day uuid;
  v_ids uuid[];
begin
  if v_prep is null or (p ->> 'session') not in ('EU', 'US') or (p ->> 'date') is null then
    raise exception 'save_prep: id, date and session are required' using errcode = '22023';
  end if;
  v_day := public.ensure_trading_day((p ->> 'date')::date);

  insert into public.session_preps as sp (
    id, day_id, session, sleep, energy, focus, how_am_i, brief_md, prior_day_type, regime,
    vol_state, narrative, options_notes, focus_instrument_ids, focus_playbook_ids, intention,
    max_loss_usd, max_loss_r, max_trades, max_size, completed_at, copied_from_id
  ) values (
    v_prep, v_day, p ->> 'session',
    (p ->> 'sleep')::smallint, (p ->> 'energy')::smallint, (p ->> 'focus')::smallint,
    nullif(p ->> 'how_am_i', ''), nullif(p ->> 'brief_md', ''),
    nullif(p ->> 'prior_day_type', ''), nullif(p ->> 'regime', ''), nullif(p ->> 'vol_state', ''),
    nullif(p ->> 'narrative', ''), nullif(p ->> 'options_notes', ''),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'focus_instrument_ids') x), '{}'),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'focus_playbook_ids') x), '{}'),
    nullif(p ->> 'intention', ''),
    (p ->> 'max_loss_usd')::numeric, (p ->> 'max_loss_r')::numeric,
    (p ->> 'max_trades')::int, (p ->> 'max_size')::numeric,
    (p ->> 'completed_at')::timestamptz, (p ->> 'copied_from_id')::uuid
  )
  on conflict (id) do update set
    sleep = excluded.sleep, energy = excluded.energy, focus = excluded.focus,
    how_am_i = excluded.how_am_i, brief_md = excluded.brief_md,
    prior_day_type = excluded.prior_day_type, regime = excluded.regime,
    vol_state = excluded.vol_state, narrative = excluded.narrative,
    options_notes = excluded.options_notes,
    focus_instrument_ids = excluded.focus_instrument_ids,
    focus_playbook_ids = excluded.focus_playbook_ids, intention = excluded.intention,
    max_loss_usd = excluded.max_loss_usd, max_loss_r = excluded.max_loss_r,
    max_trades = excluded.max_trades, max_size = excluded.max_size,
    completed_at = excluded.completed_at, copied_from_id = excluded.copied_from_id,
    deleted_at = null;

  -- Key levels
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p -> 'levels', '[]')) x;
  update public.key_levels set deleted_at = now()
   where prep_id = v_prep and deleted_at is null and not (id = any (v_ids));
  insert into public.key_levels as kl
    (id, prep_id, instrument_id, price_low, price_high, level_type, strength, note, carried_from_id, sort)
  select (x ->> 'id')::uuid, v_prep, (x ->> 'instrument_id')::uuid,
         (x ->> 'price_low')::numeric, (x ->> 'price_high')::numeric,
         x ->> 'level_type', coalesce((x ->> 'strength')::smallint, 2),
         nullif(x ->> 'note', ''), (x ->> 'carried_from_id')::uuid, ord::int
    from jsonb_array_elements(coalesce(p -> 'levels', '[]')) with ordinality as t (x, ord)
  on conflict (id) do update set
    instrument_id = excluded.instrument_id, price_low = excluded.price_low,
    price_high = excluded.price_high, level_type = excluded.level_type,
    strength = excluded.strength, note = excluded.note,
    carried_from_id = excluded.carried_from_id, sort = excluded.sort, deleted_at = null
  where kl.prep_id = v_prep;

  -- Scenarios
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p -> 'scenarios', '[]')) x;
  update public.scenarios set deleted_at = now()
   where prep_id = v_prep and deleted_at is null and not (id = any (v_ids));
  insert into public.scenarios as sc
    (id, prep_id, instrument_id, direction, if_text, then_text, playbook_id, primary_domain, sort)
  select (x ->> 'id')::uuid, v_prep, (x ->> 'instrument_id')::uuid, nullif(x ->> 'direction', ''),
         coalesce(x ->> 'if_text', ''), coalesce(x ->> 'then_text', ''),
         (x ->> 'playbook_id')::uuid, nullif(x ->> 'primary_domain', ''), ord::int
    from jsonb_array_elements(coalesce(p -> 'scenarios', '[]')) with ordinality as t (x, ord)
  on conflict (id) do update set
    instrument_id = excluded.instrument_id, direction = excluded.direction,
    if_text = excluded.if_text, then_text = excluded.then_text,
    playbook_id = excluded.playbook_id, primary_domain = excluded.primary_domain,
    sort = excluded.sort, deleted_at = null
  where sc.prep_id = v_prep;

  -- Rules acknowledged in this prep
  insert into public.rule_checks as rc (rule_id, day_id, prep_id, context, followed)
  select (x ->> 'rule_id')::uuid, v_day, v_prep, 'prep', (x ->> 'followed')::boolean
    from jsonb_array_elements(coalesce(p -> 'rule_checks', '[]')) x
  on conflict (rule_id, prep_id) where prep_id is not null and deleted_at is null
  do update set followed = excluded.followed;

  return v_prep;
end;
$$;

-- Upsert generated calendar rows (FLOW dates, recurring templates) for a
-- window. Keys identify the period ("opex:2026-10"), so a changed holiday
-- moves the row instead of duplicating it. User edits to notes, importance
-- and instruments survive; a row the user deleted stays deleted. Future rows
-- no longer produced (template switched off) are removed unless a trade links
-- to them.
create or replace function public.sync_generated_events(
  p_from timestamptz,
  p_to timestamptz,
  p_events jsonb
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keys text[];
  v_count int;
begin
  select coalesce(array_agg(x ->> 'generator_key'), '{}') into v_keys
    from jsonb_array_elements(coalesce(p_events, '[]')) x;

  delete from public.calendar_events e
   where e.user_id = (select auth.uid())
     and e.generator_key is not null
     and e.starts_at >= greatest(p_from, now()) and e.starts_at < p_to
     and not (e.generator_key = any (v_keys))
     and not exists (select 1 from public.trades t where t.calendar_event_id = e.id);

  insert into public.calendar_events as e
    (starts_at, native_tz, primary_domain, category, title, importance, instruments, notes, source, generator_key)
  select (x ->> 'starts_at')::timestamptz, x ->> 'native_tz', x ->> 'primary_domain',
         x ->> 'category', x ->> 'title', (x ->> 'importance')::smallint,
         coalesce((select array_agg(i) from jsonb_array_elements_text(x -> 'instruments') i), '{}'),
         nullif(x ->> 'notes', ''), x ->> 'source', x ->> 'generator_key'
    from jsonb_array_elements(coalesce(p_events, '[]')) x
  on conflict (user_id, generator_key) where generator_key is not null
  do update set starts_at = excluded.starts_at, native_tz = excluded.native_tz,
                title = excluded.title, category = excluded.category
  where (e.starts_at, e.native_tz, e.title, e.category)
        is distinct from (excluded.starts_at, excluded.native_tz, excluded.title, excluded.category);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.ensure_trading_day(date) from public, anon;
revoke all on function public.save_prep(jsonb) from public, anon;
revoke all on function public.sync_generated_events(timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.ensure_trading_day(date) to authenticated;
grant execute on function public.save_prep(jsonb) to authenticated;
grant execute on function public.sync_generated_events(timestamptz, timestamptz, jsonb) to authenticated;
