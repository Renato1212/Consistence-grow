-- Phase 8: CSV import (transactional, idempotent), weekly backups to a
-- private Storage bucket, and the hard purge of 30-day-old trash.

-- ---------------------------------------------------------------------------
-- Import: trades + raw fills in one transaction. Runs as the signed-in user
-- (RLS applies; the trade trigger computes P&L, R, day, session…).
-- A trade whose import_hash exists is skipped; a fill hash that exists aborts
-- the whole import (unique (user_id, hash)) so nothing is half-written.
-- ---------------------------------------------------------------------------
create or replace function public.import_trades(p_trades jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t jsonb;
  f jsonb;
  v_trade uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_trades) is distinct from 'array' then
    raise exception 'p_trades must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_trades) > 5000 then
    raise exception 'at most 5000 trades per import' using errcode = '22023';
  end if;

  for t in select value from jsonb_array_elements(p_trades) loop
    if coalesce(t ->> 'import_hash', '') = '' or jsonb_typeof(t -> 'fills') is distinct from 'array' then
      raise exception 'each trade needs import_hash and fills' using errcode = '22023';
    end if;
    if exists (select 1 from public.trades x where x.import_hash = t ->> 'import_hash') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.trades
      (kind, instrument_id, direction, entry_at, exit_at, entry_price, exit_price,
       contracts, fees, needs_review, import_hash)
    values
      ('taken', (t ->> 'instrument_id')::uuid, t ->> 'direction',
       (t ->> 'entry_at')::timestamptz, (t ->> 'exit_at')::timestamptz,
       (t ->> 'entry_price')::numeric, (t ->> 'exit_price')::numeric,
       (t ->> 'contracts')::numeric, (t ->> 'fees')::numeric, true, t ->> 'import_hash')
    returning id into v_trade;

    for f in select value from jsonb_array_elements(t -> 'fills') loop
      insert into public.fills (trade_id, executed_at, account, symbol, side, price, qty, raw, hash)
      values (v_trade, (f ->> 'executed_at')::timestamptz, f ->> 'account', f ->> 'symbol',
              f ->> 'side', (f ->> 'price')::numeric, (f ->> 'qty')::numeric,
              coalesce(f -> 'raw', '{}'::jsonb), f ->> 'hash');
    end loop;

    v_created := v_created + 1;
    v_ids := v_ids || v_trade;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'trade_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.import_trades(jsonb) from public, anon;
grant execute on function public.import_trades(jsonb) to authenticated;

create index trades_needs_review_idx on public.trades (user_id)
  where needs_review and deleted_at is null;

-- Imported trades need review until a primary domain is set.
create or replace function public.clear_needs_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.needs_review and new.primary_domain is not null
     and old.primary_domain is null and new.import_hash is not null then
    new.needs_review := false;
  end if;
  return new;
end;
$$;
create trigger clear_needs_review before update on public.trades
  for each row execute function public.clear_needs_review();

-- ---------------------------------------------------------------------------
-- Backups bucket: backups/<user_id>/<yyyy-mm-dd>.json (private, owner only).
-- The weekly cron writes with the service key; "Back up now" as the user.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy "backups: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Hard purge of soft-deleted rows older than p_days (the 30-day trash).
-- Service role only (weekly cron). Returns the media storage paths to remove
-- from the bucket and per-table counts. Instruments are never purged (trades
-- reference them with ON DELETE RESTRICT).
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
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  t text;
begin
  -- Media of trades about to be purged, plus media deleted on its own.
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
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('media_paths', coalesce(array_length(v_paths, 1), 0));

  foreach t in array array[
    'trades', 'scenarios', 'key_levels', 'session_preps', 'calendar_events',
    'playbook_checklist_items', 'playbooks', 'tags', 'tag_groups', 'rule_checks', 'rules',
    'action_items', 'saved_views', 'ai_requests', 'ai_insights', 'briefs', 'debriefs',
    'weekly_reviews', 'holidays', 'calendar_templates', 'import_presets', 'api_tokens'
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

  return jsonb_build_object('media_paths', to_jsonb(v_paths), 'counts', v_counts);
end;
$$;
revoke all on function public.purge_trash(uuid, int) from public, anon, authenticated;
grant execute on function public.purge_trash(uuid, int) to service_role;
comment on function public.purge_trash(uuid, int) is
  'Weekly cron (service role only): hard-deletes rows soft-deleted more than 30 days ago and returns media storage paths to remove.';
