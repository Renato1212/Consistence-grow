-- Restore knows routine_days.

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
