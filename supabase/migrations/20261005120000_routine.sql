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

-- Merge a patch into a block's day row: {checks?: {step: bool}, bias?: {...},
-- no_trade?: bool, followed?: yes|partly|no|'' , lesson?: text}.
create or replace function public.save_routine_day(p_date date, p_block text, p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_date is null or coalesce(p_block, '') !~ '^[a-z0-9_]{1,40}$'
     or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'save_routine_day: date, block and patch are required' using errcode = '22023';
  end if;
  insert into public.routine_days as r (date, block_key, checks, bias, no_trade, followed, lesson)
  values (
    p_date, p_block,
    case when jsonb_typeof(p_patch -> 'checks') = 'object' then p_patch -> 'checks' else '{}' end,
    case when jsonb_typeof(p_patch -> 'bias') = 'object' then p_patch -> 'bias' else '{}' end,
    coalesce((p_patch ->> 'no_trade')::boolean, false),
    nullif(p_patch ->> 'followed', ''),
    nullif(trim(p_patch ->> 'lesson'), ''))
  on conflict (user_id, date, block_key) where deleted_at is null do update set
    checks = r.checks || case when jsonb_typeof(p_patch -> 'checks') = 'object'
                              then p_patch -> 'checks' else '{}' end,
    bias = case when jsonb_typeof(p_patch -> 'bias') = 'object'
                then r.bias || (p_patch -> 'bias') else r.bias end,
    no_trade = case when p_patch ? 'no_trade' then coalesce((p_patch ->> 'no_trade')::boolean, false)
                    else r.no_trade end,
    followed = case when p_patch ? 'followed' then nullif(p_patch ->> 'followed', '') else r.followed end,
    lesson = case when p_patch ? 'lesson' then nullif(trim(p_patch ->> 'lesson'), '') else r.lesson end;
end;
$$;
revoke all on function public.save_routine_day(date, text, jsonb) from public, anon;
grant execute on function public.save_routine_day(date, text, jsonb) to authenticated;

-- The 60-second prep: narrative, instruments to watch and a bias per
-- instrument, without touching the rest of the session prep.
create or replace function public.save_quick_prep(
  p_date date,
  p_session text,
  p_narrative text,
  p_instrument_ids uuid[],
  p_bias jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day uuid;
  v_id uuid;
begin
  if p_date is null or p_session not in ('EU', 'US') then
    raise exception 'save_quick_prep: date and session are required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_bias, '{}'::jsonb)) <> 'object'
     or exists (select 1 from jsonb_each_text(coalesce(p_bias, '{}'::jsonb)) b
                 where b.value not in ('long', 'short', 'neutral')) then
    raise exception 'save_quick_prep: bias must be long, short or neutral' using errcode = '22023';
  end if;
  v_day := public.ensure_trading_day(p_date);
  insert into public.session_preps as sp (day_id, session, narrative, focus_instrument_ids, instrument_bias)
  values (v_day, p_session, nullif(trim(p_narrative), ''), coalesce(p_instrument_ids, '{}'),
          coalesce(p_bias, '{}'::jsonb))
  on conflict (day_id, session) where deleted_at is null do update set
    narrative = excluded.narrative,
    focus_instrument_ids = excluded.focus_instrument_ids,
    instrument_bias = excluded.instrument_bias
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_quick_prep(date, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.save_quick_prep(date, text, text, uuid[], jsonb) to authenticated;

-- The 2-minute debrief: one row per block (followed? lesson) and a day grade.
-- Completing it completes the day's debrief (the full debrief stays optional).
create or replace function public.save_quick_debrief(
  p_date date,
  p_grade text,
  p_lesson text,
  p_blocks jsonb,
  p_complete boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day uuid;
  v_id uuid;
  b jsonb;
begin
  if p_date is null or (p_grade is not null and p_grade not in ('A', 'B', 'C', 'F')) then
    raise exception 'save_quick_debrief: date and a grade A, B, C or F' using errcode = '22023';
  end if;
  if coalesce(p_complete, false) and p_grade is null then
    raise exception 'save_quick_debrief: grade the day to complete' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then
    raise exception 'save_quick_debrief: blocks must be an array' using errcode = '22023';
  end if;
  for b in select value from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) loop
    perform public.save_routine_day(p_date, b ->> 'block',
      jsonb_build_object('followed', coalesce(b ->> 'followed', ''),
                         'lesson', coalesce(b ->> 'lesson', '')));
  end loop;
  v_day := public.ensure_trading_day(p_date);
  insert into public.debriefs as d (day_id, grade_process, lesson, completed_at)
  values (v_day, p_grade, nullif(trim(p_lesson), ''),
          case when coalesce(p_complete, false) then now() end)
  on conflict (day_id) do update set
    grade_process = coalesce(excluded.grade_process, d.grade_process),
    lesson = coalesce(excluded.lesson, d.lesson),
    deleted_at = null,
    completed_at = case when coalesce(p_complete, false) then coalesce(d.completed_at, now())
                        else d.completed_at end
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_quick_debrief(date, text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_quick_debrief(date, text, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The four setup playbooks of the routine (drafts the trader edits).
-- ---------------------------------------------------------------------------
create or replace function private.seed_routine_defaults(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_id uuid;
  i int;
begin
  for s in
    select * from (values
      ('euNews', 'EU news event', 'NEWS', array['DATA', 'CENTRAL_BANKS'],
       'Trade only scheduled high-impact European news during the EU session.',
       $t$- A high-impact event is on today's list for the EU window (no event → no EU trade).
- Narrative from Morning Bid Europe and the Claude Pre-Open says why it matters.
- 1h chart context marked: trend or range, key levels.$t$,
       $t$- Wait for the release; trade the first clear reaction in the narrative's direction.$t$,
       $t$- Beyond the release candle.$t$,
       array['High-impact event in the EU window', '1h context and levels marked before the release',
             'Reaction confirms the narrative', 'Stop beyond the release candle']),
      ('usOpen', 'US open — 1h plan', 'TECHNICAL', array['DATA']::text[],
       'Trade the US cash open from a plan made on the 1h chart.',
       $t$- Morning Bid US and the US Pre-Open read; narrative instruments checked on the 1h chart.
- If/then plan written before 14:30 Lisbon.$t$,
       $t$- Entry at a planned 1h level; no chasing the first candle.$t$,
       $t$- Beyond the planned level.$t$,
       array['1h levels marked before the open', 'If/then plan written', 'Entry at a planned level, not chased']),
      ('scalp', 'Midday scalp — 1-min supply/demand', 'TECHNICAL', array['FLOW']::text[],
       'Scalp 1-minute supply and demand from 12:00 to 15:00 New York, with the side that is winning.',
       $t$- Winning side so far: price vs VWAP and the day's open.
- Trend day: the first-hour range broken and held. If the higher timeframe agrees, go with it.$t$,
       $t$- Fresh 1-min supply/demand zone in the direction of the winning side.$t$,
       $t$- Beyond the zone.$t$,
       array['Winning side identified (VWAP / day open)', 'Trading with the winning side',
             'Fresh 1-min zone', 'Higher timeframe aligned on a trend day']),
      ('moc', 'MOC — 5-min breakout', 'FLOW', array['TECHNICAL']::text[],
       'Trade the 5-minute breakout after the 15:50 New York market-on-close imbalance.',
       $t$- MOC imbalance published at 15:50 New York (20:50 Lisbon most of the year).$t$,
       $t$- Breakout of the 5-minute range in the imbalance direction.$t$,
       $t$- Other side of the 5-minute range; flat by the close.$t$,
       array['Imbalance read at 15:50 ET', '5-min range defined', 'Breakout in the imbalance direction',
             'Flat by the close'])
    ) as v(setup, name, domain, secondary, summary, context_md, trigger_md, stop_md, checklist)
  loop
    continue when exists (
      select 1 from public.playbooks p
       where p.user_id = p_user and p.deleted_at is null and p.notes_json ->> 'routine_setup' = s.setup);
    insert into public.playbooks
      (user_id, name, primary_domain, secondary_domains, status, summary, context_md, trigger_md,
       stop_md, notes_json)
    values (p_user, s.name, s.domain, s.secondary, 'testing', s.summary, s.context_md, s.trigger_md,
            s.stop_md, jsonb_build_object('routine_setup', s.setup))
    returning id into v_id;
    for i in 1 .. cardinality(s.checklist) loop
      insert into public.playbook_checklist_items (user_id, playbook_id, text, sort)
      values (p_user, v_id, s.checklist[i], i);
    end loop;
    insert into public.playbook_versions (user_id, playbook_id, version, snapshot)
    select p.user_id, p.id, 1,
           jsonb_build_object(
             'name', p.name, 'primary_domain', p.primary_domain,
             'secondary_domains', to_jsonb(p.secondary_domains), 'markets', to_jsonb(p.markets),
             'status', p.status, 'summary', p.summary, 'context_md', p.context_md,
             'edge_md', p.edge_md, 'trigger_md', p.trigger_md, 'stop_md', p.stop_md,
             'targets_md', p.targets_md, 'avoid_md', p.avoid_md,
             'checklist', to_jsonb(s.checklist))
      from public.playbooks p where p.id = v_id;
  end loop;
end;
$$;
revoke all on function private.seed_routine_defaults(uuid) from public, anon, authenticated;

create or replace function private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_phase3_defaults(new.id);
  perform private.seed_statement_defaults(new.id);
  perform private.seed_routine_defaults(new.id);
  return new;
end;
$$;

select private.seed_routine_defaults(id) from auth.users;

-- ---------------------------------------------------------------------------
-- Statement trades can carry their setup.
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
  v_playbook uuid;
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
    v_playbook := nullif(t ->> 'playbook_id', '')::uuid;
    if v_playbook is not null and not exists (
      select 1 from public.playbooks pb where pb.id = v_playbook and pb.deleted_at is null) then
      raise exception 'trade %: setup not found', i using errcode = '22023';
    end if;
    if v_link is not null then
      if not exists (select 1 from public.trades x
                      where x.id = v_link and x.deleted_at is null and x.kind = 'taken'
                        and x.instrument_id = pr.instrument_id) then
        raise exception 'trade %: the journal trade to link was not found', i using errcode = '22023';
      end if;
      v_trade := v_link;
      v_linked := v_linked + 1;
      if v_playbook is not null then
        update public.trades set playbook_id = v_playbook
         where id = v_link and playbook_id is null;
      end if;
    else
      insert into public.trades
        (kind, instrument_id, direction, entry_at, exit_at, entry_price, exit_price, contracts,
         fees, needs_review, time_estimated, import_hash, playbook_id)
      values
        ('taken', pr.instrument_id, t ->> 'direction', v_entry, v_exit,
         case when t ->> 'direction' = 'long' then v_avg_buy else v_avg_sell end,
         case when t ->> 'direction' = 'long' then v_avg_sell else v_avg_buy end,
         v_buy_qty, v_fees, true, v_est, 'stmt:' || v_st::text, v_playbook)
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

-- ---------------------------------------------------------------------------
-- Purge and restore know routine_days.
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
    'weekly_reviews', 'holidays', 'calendar_templates', 'import_presets', 'statement_trades', 'statements', 'routine_days',
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
    'statement_fills', 'statement_code_map', 'statement_trades', 'statement_allocations', 'routine_days'
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
