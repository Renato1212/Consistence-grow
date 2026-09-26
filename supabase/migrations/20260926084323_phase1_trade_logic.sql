-- Phase 1: trade computations, analytics view, media storage.

-- Fees the user typed (override) vs. fees actually applied.
alter table public.trades add column fees_total numeric;

-- ---------------------------------------------------------------------------
-- compute_trade: every derived trade field is computed here, never typed.
-- Mirrored in src/lib/trading/*.ts for instant UI previews; a DB test keeps
-- both implementations identical.
-- ---------------------------------------------------------------------------
create or replace function public.compute_trade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inst record;
  s record;
  dir int;
  local_ts timestamp;
  risk_ticks numeric;
  us_tz text;
  eu_tz text;
  ny_date date;
  ldn_date date;
  us_start timestamptz;
  us_end timestamptz;
  eu_start timestamptz;
  lis_date date;
  v_day uuid;
  ev_start timestamptz;
begin
  select i.tick_size, i.tick_value, i.fee_per_contract, i.exchange_tz
    into inst
    from public.instruments i
   where i.id = new.instrument_id and i.user_id = new.user_id;
  if not found then
    raise exception 'Instrument % not found for this user', new.instrument_id using errcode = '23503';
  end if;

  select * into s from public.user_settings us where us.user_id = new.user_id;

  dir := case when new.direction = 'long' then 1 else -1 end;

  -- Price move
  if new.exit_price is not null then
    new.ticks := round(((new.exit_price - new.entry_price) * dir) / inst.tick_size, 6);
  else
    new.ticks := null;
  end if;

  -- Money (observed moves are studies, not trades: no P&L)
  if new.kind <> 'observed' and new.contracts is not null then
    new.fees_total := round(coalesce(new.fees, inst.fee_per_contract * new.contracts), 4);
  else
    new.fees_total := null;
  end if;

  if new.kind <> 'observed' and new.ticks is not null and new.contracts is not null then
    new.gross_pnl := round(new.ticks * inst.tick_value * new.contracts, 4);
    new.net_pnl := new.gross_pnl - new.fees_total;
  else
    new.gross_pnl := null;
    new.net_pnl := null;
  end if;

  -- R: net P&L divided by initial risk in money. No stop -> no R.
  new.no_stop := new.stop_price is null;
  if new.stop_price is not null and new.contracts is not null and new.kind <> 'observed' then
    risk_ticks := abs(new.entry_price - new.stop_price) / inst.tick_size;
    new.risk_usd := round(risk_ticks * inst.tick_value * new.contracts, 4);
    if new.risk_usd > 0 and new.net_pnl is not null then
      new.r_multiple := round(new.net_pnl / new.risk_usd, 4);
    else
      new.r_multiple := null;
    end if;
  else
    new.risk_usd := null;
    new.r_multiple := null;
  end if;

  -- Time
  if new.exit_at is not null then
    new.duration_sec := floor(extract(epoch from (new.exit_at - new.entry_at)))::int;
  else
    new.duration_sec := null;
  end if;

  local_ts := new.entry_at at time zone inst.exchange_tz;
  new.weekday := extract(isodow from local_ts)::smallint;
  new.time_bucket := to_char(
    date_trunc('hour', local_ts) + (floor(extract(minute from local_ts) / 30) * 30) * interval '1 minute',
    'HH24:MI'
  );

  -- Session, defined in each session's native time zone
  us_tz := coalesce(s.us_session_tz, 'America/New_York');
  eu_tz := coalesce(s.eu_session_tz, 'Europe/London');
  ny_date := (new.entry_at at time zone us_tz)::date;
  ldn_date := (new.entry_at at time zone eu_tz)::date;
  us_start := (ny_date + coalesce(s.us_session_start, '08:00'::time)) at time zone us_tz;
  us_end := (ny_date + coalesce(s.us_session_end, '17:00'::time)) at time zone us_tz;
  eu_start := (ldn_date + coalesce(s.eu_session_start, '07:00'::time)) at time zone eu_tz;
  new.session := case
    when new.entry_at >= us_start and new.entry_at < us_end then 'US'
    when new.entry_at >= eu_start and new.entry_at < us_start then 'EU'
    else 'ASIA'
  end;

  -- Trading day = calendar date in the display time zone (Lisbon)
  lis_date := (new.entry_at at time zone coalesce(s.display_tz, 'Europe/Lisbon'))::date;
  insert into public.trading_days (user_id, date)
  values (new.user_id, lis_date)
  on conflict (user_id, date) do nothing;
  select d.id into v_day from public.trading_days d where d.user_id = new.user_id and d.date = lis_date;
  new.day_id := v_day;

  -- Playbook version the trade was taken under (frozen once set)
  if new.playbook_id is null then
    new.playbook_version := null;
  elsif tg_op = 'INSERT' or new.playbook_id is distinct from old.playbook_id then
    select p.version into new.playbook_version from public.playbooks p where p.id = new.playbook_id;
  end if;

  -- Minutes relative to the linked event (negative = before)
  if new.calendar_event_id is null then
    new.minutes_from_event := null;
  else
    select e.starts_at into ev_start from public.calendar_events e where e.id = new.calendar_event_id;
    new.minutes_from_event := round(extract(epoch from (new.entry_at - ev_start)) / 60)::int;
  end if;

  return new;
end;
$$;

create trigger compute_trade
  before insert or update on public.trades
  for each row execute function public.compute_trade();

revoke execute on function public.compute_trade() from public, anon;

-- ---------------------------------------------------------------------------
-- trade_facts: one flat row per live trade for analytics (RLS applies).
-- ---------------------------------------------------------------------------
create view public.trade_facts
with (security_invoker = true)
as
select
  t.*,
  i.symbol,
  i.asset_class,
  i.exchange,
  d.date as trade_date,
  p.name as playbook_name,
  p.status as playbook_status,
  e.title as event_title,
  e.category as event_category,
  e.primary_domain as event_domain,
  e.importance as event_importance,
  kl.level_type,
  kl.strength as level_strength,
  sp.id as prep_id,
  (sp.completed_at is not null) as prep_done,
  sp.regime,
  sp.prior_day_type,
  sp.vol_state,
  case
    when sp.sleep is not null and sp.energy is not null and sp.focus is not null
      then round((sp.sleep + sp.energy + sp.focus) / 3.0, 2)
  end as readiness,
  case when t.primary_domain is null then 0 else 1 + cardinality(t.secondary_domains) end as domain_count,
  coalesce(tg.tag_ids, '{}') as tag_ids,
  coalesce(tg.tag_names, '{}') as tag_names,
  case when t.net_pnl > 0 then true when t.net_pnl < 0 then false end as is_win
from public.trades t
join public.instruments i on i.id = t.instrument_id
left join public.trading_days d on d.id = t.day_id
left join public.playbooks p on p.id = t.playbook_id
left join public.calendar_events e on e.id = t.calendar_event_id and e.deleted_at is null
left join public.key_levels kl on kl.id = t.key_level_id and kl.deleted_at is null
left join lateral (
  select x.*
    from public.session_preps x
   where x.day_id = t.day_id and x.deleted_at is null
   order by (x.session = case when t.session = 'US' then 'US' else 'EU' end) desc, x.started_at
   limit 1
) sp on true
left join lateral (
  select array_agg(tt.tag_id order by g.name) as tag_ids, array_agg(g.name order by g.name) as tag_names
    from public.trade_tags tt
    join public.tags g on g.id = tt.tag_id and g.deleted_at is null
   where tt.trade_id = t.id
) tg on true
where t.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Storage: private media bucket, path user_id/owner_type/owner_id/filename
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do nothing;

create policy "media: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
