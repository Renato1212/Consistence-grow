-- Phase 9: tag management. An archived tag leaves the pickers but keeps its
-- history in Insights (unlike delete, which removes it from the stats). Merge
-- moves every trade from one tag to another in one transaction and can be
-- undone with the returned link lists.

alter table public.tags add column archived_at timestamptz;

create or replace function public.merge_tags(p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_links uuid[];
  v_had uuid[];
begin
  if p_from = p_into then
    raise exception 'choose a different tag' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tags where id = p_into and deleted_at is null)
     or not exists (select 1 from public.tags where id = p_from and deleted_at is null) then
    raise exception 'tag not found' using errcode = '22023';
  end if;

  select coalesce(array_agg(trade_id), '{}') into v_links
    from public.trade_tags where tag_id = p_from;
  select coalesce(array_agg(tt.trade_id), '{}') into v_had
    from public.trade_tags tt where tt.tag_id = p_into and tt.trade_id = any (v_links);

  insert into public.trade_tags (trade_id, tag_id)
  select unnest(v_links), p_into
  on conflict do nothing;
  delete from public.trade_tags where tag_id = p_from;
  update public.tags set deleted_at = now() where id = p_from;

  return jsonb_build_object('links', to_jsonb(v_links), 'had_target', to_jsonb(v_had));
end;
$$;
revoke all on function public.merge_tags(uuid, uuid) from public, anon;
grant execute on function public.merge_tags(uuid, uuid) to authenticated;

-- Undo a merge: restore the source tag and its links; remove the target links
-- the merge added.
create or replace function public.unmerge_tags(
  p_from uuid,
  p_into uuid,
  p_links uuid[],
  p_had_target uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.tags set deleted_at = null where id = p_from;
  if not found then
    raise exception 'tag not found' using errcode = '22023';
  end if;
  insert into public.trade_tags (trade_id, tag_id)
  select t.id, p_from
    from public.trades t
   where t.id = any (coalesce(p_links, '{}'))
  on conflict do nothing;
  delete from public.trade_tags
   where tag_id = p_into
     and trade_id = any (coalesce(p_links, '{}'))
     and not (trade_id = any (coalesce(p_had_target, '{}')));
end;
$$;
revoke all on function public.unmerge_tags(uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.unmerge_tags(uuid, uuid, uuid[], uuid[]) to authenticated;

-- How many live trades carry each tag (Settings → Tags).
create or replace function public.tag_usage()
returns table (tag_id uuid, trades bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select tt.tag_id, count(*)
    from public.trade_tags tt
    join public.trades t on t.id = tt.trade_id and t.deleted_at is null
   group by tt.tag_id;
$$;
revoke all on function public.tag_usage() from public, anon;
grant execute on function public.tag_usage() to authenticated;

-- Cheap token check so token endpoints refuse bad tokens before doing any
-- work (e.g. parsing an uploaded PDF). Tokens are 256-bit random; answering
-- valid/invalid reveals nothing guessable. Does not stamp last_used_at.
create or replace function public.token_valid(p_token text, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.api_tokens t
     where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
       and t.revoked_at is null and t.deleted_at is null
       and p_scope = any (t.scopes));
$$;
revoke all on function public.token_valid(text, text) from public, authenticated;
grant execute on function public.token_valid(text, text) to anon;

-- Invoker function with nothing for anonymous callers (RLS), but keep the
-- grant list tidy.
revoke execute on function public.append_playbook_note(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Restore from a backup file: re-insert rows that are missing (by primary
-- key) for the signed-in user. Never overwrites existing rows; user_id is
-- always the caller's; generated columns are left to the database; triggers
-- recompute derived trade fields. Tables are restored parent-first by the app.
-- ---------------------------------------------------------------------------
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
    'statement_fills', 'statement_code_map'
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
revoke all on function public.restore_rows(text, jsonb) from public, anon;
grant execute on function public.restore_rows(text, jsonb) to authenticated;
