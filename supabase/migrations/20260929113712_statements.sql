-- Broker statements: the daily Axia "Daily Detail Statement" PDF, parsed on
-- the server into a statement (financial summary), its products (per contract
-- P/L and volume) and its fills. One active statement per account and trade
-- date; a corrected statement replaces the old one (kept in the trash).

-- ---------------------------------------------------------------------------
-- Instruments used by the statements that were missing from the defaults.
-- ---------------------------------------------------------------------------
create or replace function private.seed_statement_defaults(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.instruments
    (user_id, symbol, name, exchange, asset_class, tick_size, tick_value, currency, exchange_tz, price_format, sort_order)
  select p_user, v.symbol, v.name, v.exchange, v.asset_class, v.tick_size, v.tick_value, 'USD',
         'America/Chicago', 'decimal', v.sort_order
    from (values
      ('MCL', 'Micro WTI Crude Oil', 'NYMEX', 'energy', 0.01::numeric, 1.00::numeric, 75),
      ('MGC', 'Micro Gold',          'COMEX', 'metals', 0.10::numeric, 1.00::numeric, 95)
    ) as v(symbol, name, exchange, asset_class, tick_size, tick_value, sort_order)
   where not exists (
     select 1 from public.instruments i where i.user_id = p_user and i.symbol = v.symbol);
end;
$$;
revoke all on function private.seed_statement_defaults(uuid) from public, anon, authenticated;

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
  return new;
end;
$$;

select private.seed_statement_defaults(id) from auth.users;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  broker text not null default 'axia' check (broker in ('axia')),
  format text not null,
  parser_version int not null,
  source text not null default 'upload' check (source in ('upload', 'api')),
  client_code text not null,
  account text not null,
  trade_date date not null,
  program text,
  simulated boolean not null default false,
  currency text not null default 'USD',
  realized_pnl numeric(14, 2) not null default 0,
  total_fees numeric(14, 2) not null default 0 check (total_fees >= 0),
  net_pnl numeric(14, 2) generated always as (realized_pnl - total_fees) stored,
  open_cash numeric(14, 2),
  close_cash numeric(14, 2),
  open_trade_equity numeric(14, 2),
  total_equity numeric(14, 2),
  net_liquid_value numeric(14, 2),
  initial_margin numeric(14, 2),
  maintenance_margin numeric(14, 2),
  mtd_realized_pnl numeric(14, 2),
  mtd_fees numeric(14, 2),
  contracts int not null default 0 check (contracts >= 0),
  fills int not null default 0 check (fills >= 0),
  summary jsonb not null default '{}'::jsonb,
  summary_rows jsonb not null default '{}'::jsonb,
  nlv_history jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'attention')),
  unparsed jsonb not null default '[]'::jsonb,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_name text,
  file_path text,
  raw_text text check (length(raw_text) <= 500000)
);
create unique index statements_account_day_uidx
  on public.statements (user_id, account, trade_date) where deleted_at is null;
create unique index statements_file_uidx
  on public.statements (user_id, file_hash) where deleted_at is null;
create index statements_user_day_idx on public.statements (user_id, trade_date desc);

create table public.statement_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statement_id uuid not null references public.statements (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trade_date date not null,
  code text not null,
  contract text not null,
  exchange text not null default '',
  description text not null default '',
  currency text not null default 'USD',
  default_symbol text,
  default_price_scale numeric not null default 1 check (default_price_scale > 0),
  instrument_id uuid references public.instruments (id) on delete set null,
  price_scale numeric not null default 1 check (price_scale > 0),
  long_qty int not null default 0 check (long_qty >= 0),
  short_qty int not null default 0 check (short_qty >= 0),
  fills int not null default 0 check (fills >= 0),
  realized_pnl numeric(14, 2),
  amount_sum numeric(16, 2),
  avg_buy numeric,
  avg_sell numeric,
  implied_multiplier numeric
);
create index statement_products_statement_idx on public.statement_products (statement_id);
create index statement_products_user_day_idx on public.statement_products (user_id, trade_date);
create index statement_products_instrument_idx on public.statement_products (instrument_id);

create table public.statement_fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statement_id uuid not null references public.statements (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  section text not null check (section in ('confirmation', 'purchase')),
  seq int not null,
  trade_date date not null,
  code text not null,
  contract text not null,
  side text not null check (side in ('buy', 'sell')),
  qty int not null check (qty > 0),
  price_text text not null,
  price numeric,
  type text not null default 'FUT',
  currency text not null default 'USD',
  amount numeric(16, 2)
);
create index statement_fills_statement_idx on public.statement_fills (statement_id, seq);
create index statement_fills_user_idx on public.statement_fills (user_id);

-- The owner's own product code → instrument mapping (overrides the defaults).
create table public.statement_code_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  broker text not null default 'axia' check (broker in ('axia')),
  code text not null check (length(code) between 1 and 20),
  instrument_id uuid not null references public.instruments (id) on delete cascade,
  price_scale numeric not null default 1 check (price_scale > 0)
);
create unique index statement_code_map_uidx
  on public.statement_code_map (user_id, broker, code) where deleted_at is null;
create index statement_code_map_instrument_idx on public.statement_code_map (instrument_id);

do $$
declare
  t text;
begin
  foreach t in array array['statements', 'statement_products', 'statement_fills', 'statement_code_map'] loop
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

-- ---------------------------------------------------------------------------
-- Store a parsed statement (one transaction). The payload is built on the
-- server from the PDF; products carry the default symbol and the owner's code
-- map wins. Returns {status: created | duplicate | conflict | replaced, id}.
-- A conflict (same account + day, different file) changes nothing unless
-- p_replace, which moves the old statement to the trash.
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

  return jsonb_build_object(
    'status', case when v_existing is null then 'created' else 'replaced' end,
    'id', v_id,
    'replaced_id', v_existing);
end;
$$;
revoke all on function private.store_statement(uuid, jsonb, boolean, text) from public, anon, authenticated;

-- Signed-in upload (the route handler parses the PDF, then calls this).
create or replace function public.save_statement(p_statement jsonb, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  return private.store_statement(v_user, p_statement, p_replace, 'upload');
end;
$$;
revoke all on function public.save_statement(jsonb, boolean) from public, anon;
grant execute on function public.save_statement(jsonb, boolean) to authenticated;

-- Token upload (POST /api/ingest/statement with a "statements" token).
alter table public.api_tokens drop constraint api_tokens_scopes_check;
alter table public.api_tokens
  add constraint api_tokens_scopes_check
  check (cardinality(scopes) >= 1 and scopes <@ array['briefs', 'ai', 'statements']::text[]);

create or replace function public.ingest_statement(
  p_token text,
  p_statement jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'statements');
begin
  return private.store_statement(v_user, p_statement - 'file_path', p_replace, 'api');
end;
$$;
revoke all on function public.ingest_statement(text, jsonb, boolean) from public, authenticated;
grant execute on function public.ingest_statement(text, jsonb, boolean) to anon;

-- Map a product code to an instrument for every past and future statement.
-- p_instrument null removes the owner's mapping (back to the default symbol).
create or replace function public.map_statement_code(
  p_code text,
  p_instrument uuid,
  p_price_scale numeric default 1
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.statement_code_map set deleted_at = now()
   where broker = 'axia' and code = p_code and deleted_at is null;
  if p_instrument is not null then
    insert into public.statement_code_map (broker, code, instrument_id, price_scale)
    values ('axia', p_code, p_instrument, coalesce(p_price_scale, 1));
    update public.statement_products
       set instrument_id = p_instrument, price_scale = coalesce(p_price_scale, 1)
     where code = p_code;
  else
    update public.statement_products sp
       set instrument_id = (select i.id from public.instruments i
                             where i.user_id = sp.user_id and i.symbol = sp.default_symbol
                               and i.deleted_at is null),
           price_scale = sp.default_price_scale
     where sp.code = p_code;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.map_statement_code(text, uuid, numeric) from public, anon;
grant execute on function public.map_statement_code(text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Statement PDFs: statements/<user_id>/<account>/<trade_date>-<hash8>.pdf
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statements', 'statements', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "statements: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "statements: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "statements: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Purge: statements join the 30-day trash; their PDFs are returned for removal.
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
    'weekly_reviews', 'holidays', 'calendar_templates', 'import_presets', 'statements',
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
revoke all on function public.purge_trash(uuid, int) from public, anon, authenticated;
grant execute on function public.purge_trash(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- AI routine: the last 120 days of broker statements (per day and product),
-- read with an "ai" token next to ai_context for the weekly analysis.
-- ---------------------------------------------------------------------------
create or replace function public.ai_statements(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'date', s.trade_date, 'account', s.account, 'simulated', s.simulated,
             'realized', s.realized_pnl, 'fees', s.total_fees, 'net', s.net_pnl,
             'contracts', s.contracts, 'checks', s.status,
             'products', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'instrument', coalesce(i.symbol, 'code ' || p.code),
                        'realized', p.realized_pnl,
                        'contracts', p.long_qty + p.short_qty) order by p.code)
                 from public.statement_products p
                 left join public.instruments i on i.id = p.instrument_id
                where p.statement_id = s.id), '[]'::jsonb))
           order by s.trade_date, s.account)
      from public.statements s
     where s.user_id = v_user and s.deleted_at is null
       and s.trade_date >= (now() at time zone 'Europe/Lisbon')::date - 120), '[]'::jsonb);
end;
$$;
revoke all on function public.ai_statements(text) from public, authenticated;
grant execute on function public.ai_statements(text) to anon;
