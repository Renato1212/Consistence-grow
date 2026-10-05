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

