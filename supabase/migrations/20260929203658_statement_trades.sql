-- Statement trades: a statement product's day split into round-trip trades.
-- The Axia PDF has no fill times, so the split is chosen by the owner (from
-- suggestions, by hand, or by matching trades already in the journal) and
-- stored as allocations of broker fills to trades. Building creates journal
-- trades (or links existing ones) in one transaction; Undo reverses it.

-- ---------------------------------------------------------------------------
-- Trades whose times are not known (built from a statement without times):
-- no time bucket, session or duration, so time-of-day stats skip them.
-- Editing the entry time in the journal makes the time exact again.
-- ---------------------------------------------------------------------------
alter table public.trades add column time_estimated boolean not null default false;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.statement_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  statement_id uuid not null references public.statements (id) on delete cascade,
  product_id uuid not null references public.statement_products (id) on delete cascade,
  build_id uuid not null,
  seq int not null check (seq >= 1),
  method text not null check (method in ('suggested', 'manual', 'one', 'journal')),
  origin text not null check (origin in ('created', 'linked')),
  trade_id uuid references public.trades (id) on delete set null,
  direction text not null check (direction in ('long', 'short')),
  contracts int not null check (contracts > 0),
  avg_buy numeric not null,
  avg_sell numeric not null,
  gross_pnl numeric(14, 4) not null,
  fees numeric(14, 2) not null default 0 check (fees >= 0),
  time_estimated boolean not null default true
);
create unique index statement_trades_product_seq_uidx
  on public.statement_trades (product_id, seq) where deleted_at is null;
create unique index statement_trades_trade_uidx
  on public.statement_trades (trade_id) where deleted_at is null and trade_id is not null;
create index statement_trades_statement_idx on public.statement_trades (statement_id);
create index statement_trades_user_idx on public.statement_trades (user_id);
create index statement_trades_build_idx on public.statement_trades (build_id);

create table public.statement_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  statement_trade_id uuid not null references public.statement_trades (id) on delete cascade,
  fill_id uuid not null references public.statement_fills (id) on delete cascade,
  qty int not null check (qty > 0)
);
create index statement_allocations_trade_idx on public.statement_allocations (statement_trade_id);
create index statement_allocations_fill_idx on public.statement_allocations (fill_id);
create index statement_allocations_user_idx on public.statement_allocations (user_id);

do $$
declare
  t text;
begin
  foreach t in array array['statement_trades', 'statement_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%1$s: owner" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- A fill is never allocated beyond its quantity (live builds only).
create or replace function private.check_statement_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_qty int;
begin
  select f.qty into v_qty from public.statement_fills f where f.id = new.fill_id;
  select coalesce(sum(a.qty), 0) into v_used
    from public.statement_allocations a
    join public.statement_trades st on st.id = a.statement_trade_id and st.deleted_at is null
   where a.fill_id = new.fill_id and a.deleted_at is null;
  if v_used > v_qty then
    raise exception 'fill allocated beyond its quantity (% of %)', v_used, v_qty
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.check_statement_allocation() from public, anon, authenticated;

create constraint trigger statement_allocations_qty
  after insert or update on public.statement_allocations
  for each row execute function private.check_statement_allocation();

-- ---------------------------------------------------------------------------
-- Build: p_trades = [{direction, entry_at?, exit_at?, link_trade_id?,
--   allocations: [{fill_id, qty}]}]. Every fill of the product's day must be
-- allocated exactly once and every trade must be flat. Creates journal trades
-- (taken, needs review, weighted average prices, statement fees shared by
-- contract and instrument fee) or links existing ones. Idempotent per
-- p_build; a product has at most one live build (Undo it to rebuild).
-- ---------------------------------------------------------------------------
create or replace function public.build_statement_trades(
  p_product uuid,
  p_build uuid,
  p_method text,
  p_trades jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr record;
  v_alloc jsonb;
  v_tz text;
  v_by_fee boolean;
  v_weight numeric;
  v_unit numeric;
  t jsonb;
  i int := 0;
  v_st uuid;
  v_trade uuid;
  v_buy_qty int;
  v_sell_qty int;
  v_buy_val numeric;
  v_sell_val numeric;
  v_avg_buy numeric;
  v_avg_sell numeric;
  v_gross numeric;
  v_fees numeric;
  v_entry timestamptz;
  v_exit timestamptz;
  v_est boolean;
  v_link uuid;
  v_created int := 0;
  v_linked int := 0;
  v_check numeric;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_build is null or coalesce(p_method, '') not in ('suggested', 'manual', 'one', 'journal') then
    raise exception 'build id and method are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_trades) is distinct from 'array'
     or jsonb_array_length(p_trades) not between 1 and 500 then
    raise exception 'p_trades must be an array of 1 to 500 trades' using errcode = '22023';
  end if;

  select sp.id, sp.statement_id, sp.code, sp.contract, sp.instrument_id, sp.price_scale,
         s.trade_date, s.total_fees, i.tick_size, i.tick_value, i.fee_per_contract
    into pr
    from public.statement_products sp
    join public.statements s on s.id = sp.statement_id and s.deleted_at is null
    left join public.instruments i on i.id = sp.instrument_id
   where sp.id = p_product;
  if not found then
    raise exception 'statement product not found' using errcode = 'P0002';
  end if;
  if pr.instrument_id is null then
    raise exception 'map this product to an instrument first' using errcode = '22023';
  end if;

  if exists (select 1 from public.statement_trades
              where product_id = p_product and deleted_at is null) then
    if exists (select 1 from public.statement_trades
                where product_id = p_product and deleted_at is null and build_id = p_build) then
      return jsonb_build_object(
        'status', 'exists',
        'trade_ids', (select coalesce(jsonb_agg(trade_id order by seq), '[]')
                        from public.statement_trades
                       where product_id = p_product and deleted_at is null));
    end if;
    raise exception 'this product already has trades built; undo them first' using errcode = '23505';
  end if;

  -- Allocations as rows: {n (trade number), fill_id, qty}.
  select coalesce(jsonb_agg(jsonb_build_object('n', tr.n, 'fill_id', a ->> 'fill_id', 'qty', a -> 'qty')), '[]')
    into v_alloc
    from jsonb_array_elements(p_trades) with ordinality tr(v, n),
         jsonb_array_elements(case when jsonb_typeof(tr.v -> 'allocations') = 'array'
                                   then tr.v -> 'allocations' else '[]'::jsonb end) a;

  if exists (
    select 1
      from jsonb_to_recordset(v_alloc) a(n int, fill_id uuid, qty int)
      left join public.statement_fills f
        on f.id = a.fill_id and f.statement_id = pr.statement_id and f.section = 'confirmation'
       and f.code = pr.code and f.contract = pr.contract and f.trade_date = pr.trade_date
     where f.id is null or a.qty is null or a.qty <= 0 or f.price is null) then
    raise exception 'allocations must use this product''s priced fills of the day with a positive quantity'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from (select f.id, f.qty from public.statement_fills f
             where f.statement_id = pr.statement_id and f.section = 'confirmation'
               and f.code = pr.code and f.contract = pr.contract
               and f.trade_date = pr.trade_date) f
      full join (select a.fill_id, sum(a.qty) as qty
                   from jsonb_to_recordset(v_alloc) a(n int, fill_id uuid, qty int)
                  group by a.fill_id) a on a.fill_id = f.id
     where coalesce(a.qty, 0) <> coalesce(f.qty, -1)) then
    raise exception 'every fill of the day must be allocated exactly once' using errcode = '22023';
  end if;

  select us.display_tz into v_tz from public.user_settings us where us.user_id = v_user;
  v_tz := coalesce(v_tz, 'Europe/Lisbon');

  -- Statement fees are shared by round-turn contract across the whole day,
  -- weighted by each instrument's fee (equal weights when no fees are set).
  select bool_or(coalesce(ii.fee_per_contract, 0) > 0) into v_by_fee
    from public.statement_products sp
    left join public.instruments ii on ii.id = sp.instrument_id
   where sp.statement_id = pr.statement_id;
  select sum(case when v_by_fee then coalesce(ii.fee_per_contract, 0) else 1 end * sp.long_qty)
    into v_weight
    from public.statement_products sp
    left join public.instruments ii on ii.id = sp.instrument_id
   where sp.statement_id = pr.statement_id;
  v_unit := case when v_by_fee then coalesce(pr.fee_per_contract, 0) else 1 end;

  for t in select value from jsonb_array_elements(p_trades) loop
    i := i + 1;
    if coalesce(t ->> 'direction', '') not in ('long', 'short') then
      raise exception 'trade %: direction must be long or short', i using errcode = '22023';
    end if;

    select coalesce(sum(a.qty) filter (where f.side = 'buy'), 0),
           coalesce(sum(a.qty) filter (where f.side = 'sell'), 0),
           sum(a.qty * f.price * pr.price_scale) filter (where f.side = 'buy'),
           sum(a.qty * f.price * pr.price_scale) filter (where f.side = 'sell')
      into v_buy_qty, v_sell_qty, v_buy_val, v_sell_val
      from jsonb_to_recordset(v_alloc) a(n int, fill_id uuid, qty int)
      join public.statement_fills f on f.id = a.fill_id
     where a.n = i;
    if v_buy_qty = 0 or v_buy_qty <> v_sell_qty then
      raise exception 'trade %: bought % but sold % — every trade must be flat', i, v_buy_qty, v_sell_qty
        using errcode = '22023';
    end if;
    v_gross := round((v_sell_val - v_buy_val) * pr.tick_value / pr.tick_size, 4);
    v_avg_buy := round(v_buy_val / v_buy_qty, 16);
    v_avg_sell := round(v_sell_val / v_sell_qty, 16);
    v_fees := case
      when coalesce(pr.total_fees, 0) = 0 or coalesce(v_weight, 0) = 0 then 0
      else round(pr.total_fees * v_unit * v_buy_qty / v_weight, 2)
    end;

    v_entry := nullif(t ->> 'entry_at', '')::timestamptz;
    v_exit := nullif(t ->> 'exit_at', '')::timestamptz;
    v_est := v_entry is null;
    if v_est then
      -- Midday of the trading day, one second apart to keep the order.
      v_entry := ((pr.trade_date + time '12:00') at time zone v_tz) + make_interval(secs => i);
      v_exit := v_entry;
    elsif (v_entry at time zone v_tz)::date <> pr.trade_date then
      raise exception 'trade %: the entry time is not on %', i, pr.trade_date using errcode = '22023';
    elsif v_exit is not null and v_exit < v_entry then
      raise exception 'trade %: exit before entry', i using errcode = '22023';
    end if;

    v_st := gen_random_uuid();
    v_link := nullif(t ->> 'link_trade_id', '')::uuid;
    if v_link is not null then
      if not exists (select 1 from public.trades x
                      where x.id = v_link and x.deleted_at is null and x.kind = 'taken'
                        and x.instrument_id = pr.instrument_id) then
        raise exception 'trade %: the journal trade to link was not found', i using errcode = '22023';
      end if;
      v_trade := v_link;
      v_linked := v_linked + 1;
    else
      insert into public.trades
        (kind, instrument_id, direction, entry_at, exit_at, entry_price, exit_price, contracts,
         fees, needs_review, time_estimated, import_hash)
      values
        ('taken', pr.instrument_id, t ->> 'direction', v_entry, v_exit,
         case when t ->> 'direction' = 'long' then v_avg_buy else v_avg_sell end,
         case when t ->> 'direction' = 'long' then v_avg_sell else v_avg_buy end,
         v_buy_qty, v_fees, true, v_est, 'stmt:' || v_st::text)
      returning id, gross_pnl into v_trade, v_check;
      if abs(v_check - v_gross) >= 0.005 then
        raise exception 'trade %: price rounding moved the P/L (% vs %)', i, v_check, v_gross
          using errcode = 'P0001';
      end if;
      v_created := v_created + 1;
    end if;

    insert into public.statement_trades
      (id, statement_id, product_id, build_id, seq, method, origin, trade_id, direction, contracts,
       avg_buy, avg_sell, gross_pnl, fees, time_estimated)
    values
      (v_st, pr.statement_id, p_product, p_build, i, p_method,
       case when v_link is null then 'created' else 'linked' end, v_trade, t ->> 'direction',
       v_buy_qty, v_avg_buy, v_avg_sell, v_gross, v_fees, v_est and v_link is null);

    insert into public.statement_allocations (statement_trade_id, fill_id, qty)
    select v_st, a.fill_id, a.qty
      from jsonb_to_recordset(v_alloc) a(n int, fill_id uuid, qty int)
     where a.n = i;
  end loop;

  return jsonb_build_object(
    'status', 'created',
    'created', v_created,
    'linked', v_linked,
    'trade_ids', (select coalesce(jsonb_agg(trade_id order by seq), '[]')
                    from public.statement_trades
                   where product_id = p_product and deleted_at is null));
end;
$$;
revoke all on function public.build_statement_trades(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.build_statement_trades(uuid, uuid, text, jsonb) to authenticated;

-- Undo a product's build: created journal trades go to the trash, linked ones
-- are only unlinked. Returns the trashed trade ids (for a later restore).
create or replace function public.undo_statement_build(p_product uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trashed uuid[];
  v_unlinked int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  with gone as (
    update public.trades x set deleted_at = now()
      from public.statement_trades st
     where st.product_id = p_product and st.deleted_at is null and st.origin = 'created'
       and x.id = st.trade_id and x.deleted_at is null
    returning x.id
  )
  select coalesce(array_agg(id), '{}') into v_trashed from gone;
  select count(*) into v_unlinked from public.statement_trades
   where product_id = p_product and deleted_at is null and origin = 'linked';
  update public.statement_allocations a set deleted_at = now()
    from public.statement_trades st
   where st.product_id = p_product and st.deleted_at is null and a.statement_trade_id = st.id;
  update public.statement_trades set deleted_at = now()
   where product_id = p_product and deleted_at is null;
  return jsonb_build_object('trashed', to_jsonb(v_trashed), 'unlinked', v_unlinked);
end;
$$;
revoke all on function public.undo_statement_build(uuid) from public, anon;
grant execute on function public.undo_statement_build(uuid) to authenticated;

-- A corrected statement (same account and day) keeps the builds of products
-- whose fills did not change: allocations move to the new fills.
create or replace function private.carry_statement_builds(p_old uuid, p_new uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  op record;
  v_np uuid;
begin
  for op in
    select distinct sp.id, sp.code, sp.contract, sp.trade_date
      from public.statement_products sp
      join public.statement_trades st on st.product_id = sp.id and st.deleted_at is null
     where sp.statement_id = p_old
  loop
    select np.id into v_np from public.statement_products np
     where np.statement_id = p_new and np.code = op.code and np.contract = op.contract;
    continue when v_np is null;
    -- Same fills (side, qty, price) on both statements?
    continue when exists (
      (select side, qty, price_text from public.statement_fills
        where statement_id = p_old and section = 'confirmation' and code = op.code
          and contract = op.contract and trade_date = op.trade_date
       except all
       select side, qty, price_text from public.statement_fills
        where statement_id = p_new and section = 'confirmation' and code = op.code
          and contract = op.contract and trade_date = op.trade_date)
      union all
      (select side, qty, price_text from public.statement_fills
        where statement_id = p_new and section = 'confirmation' and code = op.code
          and contract = op.contract and trade_date = op.trade_date
       except all
       select side, qty, price_text from public.statement_fills
        where statement_id = p_old and section = 'confirmation' and code = op.code
          and contract = op.contract and trade_date = op.trade_date));

    with o as (
      select id, row_number() over (partition by side, qty, price_text order by seq) as k,
             side, qty, price_text
        from public.statement_fills
       where statement_id = p_old and section = 'confirmation' and code = op.code
         and contract = op.contract and trade_date = op.trade_date
    ), n as (
      select id, row_number() over (partition by side, qty, price_text order by seq) as k,
             side, qty, price_text
        from public.statement_fills
       where statement_id = p_new and section = 'confirmation' and code = op.code
         and contract = op.contract and trade_date = op.trade_date
    )
    update public.statement_allocations a set fill_id = n.id
      from o join n using (side, qty, price_text, k)
     where a.fill_id = o.id and a.deleted_at is null;
    update public.statement_trades set statement_id = p_new, product_id = v_np
     where product_id = op.id and deleted_at is null;
  end loop;
end;
$$;
revoke all on function private.carry_statement_builds(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- compute_trade: estimated times carry no time bucket, session or duration.
-- (Mirrored in src/lib/trading/pnl.ts.)
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

  -- An estimated time becomes exact once the owner edits it.
  if tg_op = 'UPDATE' and old.time_estimated and new.time_estimated
     and (new.entry_at is distinct from old.entry_at or new.exit_at is distinct from old.exit_at) then
    new.time_estimated := false;
  end if;

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
  if new.exit_at is not null and not new.time_estimated then
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
  -- Unknown time of day: no time bucket or session (time stats skip it).
  if new.time_estimated then
    new.time_bucket := null;
    new.session := null;
  end if;

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

-- ---------------------------------------------------------------------------
-- trade_facts gains time_estimated (t.*) and broker_confirmed.
-- ---------------------------------------------------------------------------
drop view public.trade_facts;
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
  case when t.net_pnl > 0 then true when t.net_pnl < 0 then false end as is_win,
  i.currency,
  coalesce(md.media_count, 0) as media_count,
  exists (
    select 1
      from public.statement_trades st
      join public.statements s on s.id = st.statement_id and s.deleted_at is null
     where st.trade_id = t.id and st.deleted_at is null
  ) as broker_confirmed
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
left join lateral (
  select count(*)::int as media_count
    from public.media m
   where m.owner_type = 'trade' and m.owner_id = t.id and m.deleted_at is null
) md on true
where t.deleted_at is null;

-- ---------------------------------------------------------------------------
-- A corrected statement keeps the builds of unchanged products.
-- ---------------------------------------------------------------------------
create or replace function private.store_statement(
  p_user uuid,
  p_stmt jsonb,
  p_replace boolean,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := p_stmt;
  v_hash text := s ->> 'file_hash';
  v_account text := nullif(trim(s ->> 'account'), '');
  v_date date;
  v_existing uuid;
  v_existing_hash text;
  v_id uuid;
  p jsonb;
  f jsonb;
begin
  if jsonb_typeof(s) is distinct from 'object'
     or jsonb_typeof(s -> 'products') is distinct from 'array'
     or jsonb_typeof(s -> 'fills') is distinct from 'array'
     or v_account is null or coalesce(s ->> 'client_code', '') = ''
     or coalesce(v_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'statement payload is incomplete' using errcode = '22023';
  end if;
  if jsonb_array_length(s -> 'fills') > 20000 or jsonb_array_length(s -> 'products') > 500 then
    raise exception 'statement is too large' using errcode = '22023';
  end if;
  v_date := (s ->> 'trade_date')::date;

  select id into v_existing from public.statements
   where user_id = p_user and file_hash = v_hash and deleted_at is null;
  if v_existing is not null then
    return jsonb_build_object('status', 'duplicate', 'id', v_existing);
  end if;

  select id, file_hash into v_existing, v_existing_hash from public.statements
   where user_id = p_user and account = v_account and trade_date = v_date and deleted_at is null;
  if v_existing is not null and not coalesce(p_replace, false) then
    return jsonb_build_object('status', 'conflict', 'id', v_existing);
  end if;
  if v_existing is not null then
    update public.statements set deleted_at = now() where id = v_existing;
  end if;

  insert into public.statements (
    user_id, broker, format, parser_version, source, client_code, account, trade_date, program,
    simulated, currency, realized_pnl, total_fees, open_cash, close_cash, open_trade_equity,
    total_equity, net_liquid_value, initial_margin, maintenance_margin, mtd_realized_pnl, mtd_fees,
    contracts, fills, summary, summary_rows, nlv_history, checks, status, unparsed, file_hash,
    file_name, file_path, raw_text)
  values (
    p_user, 'axia', s ->> 'format', (s ->> 'parser_version')::int, p_source, s ->> 'client_code',
    v_account, v_date, s ->> 'program', coalesce((s ->> 'simulated')::boolean, false),
    coalesce(s ->> 'currency', 'USD'), coalesce((s ->> 'realized_pnl')::numeric, 0),
    abs(coalesce((s ->> 'total_fees')::numeric, 0)), (s ->> 'open_cash')::numeric,
    (s ->> 'close_cash')::numeric, (s ->> 'open_trade_equity')::numeric,
    (s ->> 'total_equity')::numeric, (s ->> 'net_liquid_value')::numeric,
    (s ->> 'initial_margin')::numeric, (s ->> 'maintenance_margin')::numeric,
    (s ->> 'mtd_realized_pnl')::numeric, (s ->> 'mtd_fees')::numeric,
    coalesce((s ->> 'contracts')::int, 0), coalesce((s ->> 'fills_count')::int, 0),
    coalesce(s -> 'summary', '{}'), coalesce(s -> 'summary_rows', '{}'),
    coalesce(s -> 'nlv_history', '[]'), coalesce(s -> 'checks', '[]'),
    coalesce(s ->> 'status', 'attention'), coalesce(s -> 'unparsed', '[]'), v_hash,
    left(s ->> 'file_name', 200), s ->> 'file_path', s ->> 'raw_text')
  returning id into v_id;

  for p in select value from jsonb_array_elements(s -> 'products') loop
    insert into public.statement_products (
      user_id, statement_id, trade_date, code, contract, exchange, description, currency,
      default_symbol, default_price_scale, instrument_id, price_scale, long_qty, short_qty, fills, realized_pnl,
      amount_sum, avg_buy, avg_sell, implied_multiplier)
    select p_user, v_id, v_date, p ->> 'code', p ->> 'contract', coalesce(p ->> 'exchange', ''),
           coalesce(p ->> 'description', ''), coalesce(p ->> 'currency', 'USD'),
           p ->> 'default_symbol', coalesce((p ->> 'price_scale')::numeric, 1),
           coalesce(m.instrument_id, d.id),
           coalesce(m.price_scale, (p ->> 'price_scale')::numeric, 1),
           coalesce((p ->> 'long_qty')::int, 0), coalesce((p ->> 'short_qty')::int, 0),
           coalesce((p ->> 'fills')::int, 0), (p ->> 'realized_pnl')::numeric,
           (p ->> 'amount_sum')::numeric, (p ->> 'avg_buy')::numeric, (p ->> 'avg_sell')::numeric,
           (p ->> 'implied_multiplier')::numeric
      from (select 1) one
      left join public.statement_code_map m
        on m.user_id = p_user and m.broker = 'axia' and m.code = p ->> 'code' and m.deleted_at is null
      left join public.instruments d
        on d.user_id = p_user and d.symbol = p ->> 'default_symbol' and d.deleted_at is null;
  end loop;

  for f in select value from jsonb_array_elements(s -> 'fills') loop
    insert into public.statement_fills (
      user_id, statement_id, section, seq, trade_date, code, contract, side, qty, price_text,
      price, type, currency, amount)
    values (
      p_user, v_id, f ->> 'section', (f ->> 'seq')::int, (f ->> 'trade_date')::date,
      f ->> 'code', f ->> 'contract', f ->> 'side', (f ->> 'qty')::int, f ->> 'price_text',
      (f ->> 'price')::numeric, coalesce(f ->> 'type', 'FUT'), coalesce(f ->> 'currency', 'USD'),
      (f ->> 'amount')::numeric);
  end loop;

  if v_existing is not null then
    perform private.carry_statement_builds(v_existing, v_id);
  end if;

  return jsonb_build_object(
    'status', case when v_existing is null then 'created' else 'replaced' end,
    'id', v_id,
    'replaced_id', v_existing);
end;
$$;

-- ---------------------------------------------------------------------------
-- Purge and restore know the new tables.
-- ---------------------------------------------------------------------------
create or replace function public.purge_trash(p_user uuid, p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_paths text[];
  v_statement_paths text[];
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  t text;
begin
  with gone as (
    delete from public.media m
     where m.user_id = p_user
       and ((m.deleted_at is not null and m.deleted_at < v_cutoff)
         or (m.owner_type = 'trade' and m.owner_id in (
               select x.id from public.trades x
                where x.user_id = p_user and x.deleted_at is not null and x.deleted_at < v_cutoff)))
    returning m.storage_path, m.thumb_path
  )
  select coalesce(array_agg(p) filter (where p is not null), '{}')
    into v_paths
    from gone, lateral unnest(array[gone.storage_path, gone.thumb_path]) p;
  v_counts := v_counts || jsonb_build_object('media_paths', coalesce(array_length(v_paths, 1), 0));

  -- A file shared by a live statement (same PDF re-uploaded) is kept.
  select coalesce(array_agg(distinct s.file_path), '{}') into v_statement_paths
    from public.statements s
   where s.user_id = p_user and s.deleted_at is not null and s.deleted_at < v_cutoff
     and s.file_path is not null
     and not exists (select 1 from public.statements l
                      where l.user_id = p_user and l.deleted_at is null and l.file_path = s.file_path);

  foreach t in array array[
    'trades', 'scenarios', 'key_levels', 'session_preps', 'calendar_events',
    'playbook_checklist_items', 'playbooks', 'tags', 'tag_groups', 'rule_checks', 'rules',
    'action_items', 'saved_views', 'ai_requests', 'ai_insights', 'briefs', 'debriefs',
    'weekly_reviews', 'holidays', 'calendar_templates', 'import_presets', 'statement_trades', 'statements',
    'statement_code_map', 'api_tokens'
  ] loop
    begin
      execute format(
        'delete from public.%I where user_id = $1 and deleted_at is not null and deleted_at < $2', t)
        using p_user, v_cutoff;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_counts := v_counts || jsonb_build_object(t, v_n);
      end if;
    exception when foreign_key_violation then
      v_counts := v_counts || jsonb_build_object(t, 'kept (still referenced)');
    end;
  end loop;

  return jsonb_build_object(
    'media_paths', to_jsonb(v_paths),
    'statement_paths', to_jsonb(v_statement_paths),
    'counts', v_counts);
end;
$$;

create or replace function public.restore_rows(p_table text, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cols text;
  v_n int;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_table <> all (array[
    'user_settings', 'instruments', 'trading_days', 'playbooks', 'playbook_versions',
    'playbook_checklist_items', 'session_preps', 'key_levels', 'scenarios', 'calendar_events',
    'calendar_templates', 'holidays', 'trades', 'fills', 'tag_groups', 'tags', 'trade_tags',
    'media', 'debriefs', 'rules', 'rule_checks', 'action_items', 'weekly_reviews', 'saved_views',
    'ai_requests', 'ai_insights', 'import_presets', 'briefs', 'statements', 'statement_products',
    'statement_fills', 'statement_code_map', 'statement_trades', 'statement_allocations'
  ]) then
    raise exception 'table % cannot be restored', p_table using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'rows must be an array of at most 1000' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  -- Columns present in the file (older backups may lack newer columns, which
  -- then take their defaults).
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and c.is_generated = 'NEVER' and c.column_name <> 'user_id'
     and p_rows -> 0 ? c.column_name;

  execute format(
    'insert into public.%1$I (%2$s, user_id)
     select %2$s, $2 from jsonb_populate_recordset(null::public.%1$I, $1)
     on conflict do nothing',
    p_table, v_cols)
    using p_rows, v_user;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
