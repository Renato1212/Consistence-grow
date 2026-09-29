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
