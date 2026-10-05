-- Purge knows routine_days. NOT YET APPLIED TO PRODUCTION (the MCP apply needs owner
-- confirmation for a function containing DELETE). Apply, then rename to the recorded version.

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

