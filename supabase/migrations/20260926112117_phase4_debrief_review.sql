-- Phase 4: daily debrief (transactional snapshot save) and weekly review.

-- Weekly reviews and action items are read by week / by source.
create index action_items_source_idx on public.action_items (user_id, source, source_id);

-- Save a whole debrief in one transaction:
--   * the debrief row (one per trading day),
--   * plan vs reality on that day's scenarios (outcome, traded) and key levels
--     (tested, respected) — only rows belonging to that day's preps,
--   * rule checks (context 'debrief', with a note for broken rules),
--   * action items created in this debrief (client ids; removed ones are
--     soft-deleted).
-- Completing requires the three pillar grades and a note on every broken rule.
create or replace function public.save_debrief(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day uuid;
  v_id uuid;
  v_ids uuid[];
  v_completed timestamptz := (p ->> 'completed_at')::timestamptz;
begin
  if (p ->> 'id') is null or (p ->> 'date') is null then
    raise exception 'save_debrief: id and date are required' using errcode = '22023';
  end if;

  if v_completed is not null then
    if coalesce(p ->> 'grade_context', '') = '' or coalesce(p ->> 'grade_edge', '') = ''
       or coalesce(p ->> 'grade_process', '') = '' then
      raise exception 'save_debrief: grade Context, Edge and Process to complete'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(p -> 'rule_checks', '[]')) x
       where (x ->> 'followed')::boolean is false and coalesce(trim(x ->> 'note'), '') = ''
    ) then
      raise exception 'save_debrief: every broken rule needs a note' using errcode = '23514';
    end if;
  end if;

  v_day := public.ensure_trading_day((p ->> 'date')::date);

  insert into public.debriefs as d (
    id, day_id, grade_context, grade_context_note, grade_edge, grade_edge_note,
    grade_process, grade_process_note, went_well, to_improve, lesson, mood, energy, completed_at
  ) values (
    (p ->> 'id')::uuid, v_day,
    nullif(p ->> 'grade_context', ''), nullif(p ->> 'grade_context_note', ''),
    nullif(p ->> 'grade_edge', ''), nullif(p ->> 'grade_edge_note', ''),
    nullif(p ->> 'grade_process', ''), nullif(p ->> 'grade_process_note', ''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'went_well') x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'to_improve') x), '{}'),
    nullif(p ->> 'lesson', ''), (p ->> 'mood')::smallint, (p ->> 'energy')::smallint, v_completed
  )
  on conflict (day_id) do update set
    grade_context = excluded.grade_context, grade_context_note = excluded.grade_context_note,
    grade_edge = excluded.grade_edge, grade_edge_note = excluded.grade_edge_note,
    grade_process = excluded.grade_process, grade_process_note = excluded.grade_process_note,
    went_well = excluded.went_well, to_improve = excluded.to_improve, lesson = excluded.lesson,
    mood = excluded.mood, energy = excluded.energy, completed_at = excluded.completed_at,
    deleted_at = null;
  select d.id into v_id from public.debriefs d where d.day_id = v_day;

  -- Plan vs reality (own day only)
  update public.scenarios s
     set outcome = nullif(x ->> 'outcome', ''), traded = (x ->> 'traded')::boolean
    from jsonb_array_elements(coalesce(p -> 'scenarios', '[]')) x
   where s.id = (x ->> 'id')::uuid
     and s.prep_id in (select sp.id from public.session_preps sp where sp.day_id = v_day)
     and (s.outcome, s.traded) is distinct from (nullif(x ->> 'outcome', ''), (x ->> 'traded')::boolean);

  update public.key_levels kl
     set tested = (x ->> 'tested')::boolean, respected = (x ->> 'respected')::boolean
    from jsonb_array_elements(coalesce(p -> 'levels', '[]')) x
   where kl.id = (x ->> 'id')::uuid
     and kl.prep_id in (select sp.id from public.session_preps sp where sp.day_id = v_day)
     and (kl.tested, kl.respected)
         is distinct from ((x ->> 'tested')::boolean, (x ->> 'respected')::boolean);

  -- Rule checks for the day
  insert into public.rule_checks as rc (rule_id, day_id, context, followed, note)
  select (x ->> 'rule_id')::uuid, v_day, 'debrief', (x ->> 'followed')::boolean,
         nullif(trim(x ->> 'note'), '')
    from jsonb_array_elements(coalesce(p -> 'rule_checks', '[]')) x
  on conflict (rule_id, day_id) where context = 'debrief' and deleted_at is null
  do update set followed = excluded.followed, note = excluded.note;

  -- Action items created in this debrief
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p -> 'action_items', '[]')) x;
  update public.action_items set deleted_at = now()
   where source = 'debrief' and source_id = v_id and deleted_at is null
     and not (id = any (v_ids));
  insert into public.action_items as a (id, source, source_id, text, show_in_prep, status, closed_at)
  select (x ->> 'id')::uuid, 'debrief', v_id, trim(x ->> 'text'),
         coalesce((x ->> 'show_in_prep')::boolean, true),
         coalesce(nullif(x ->> 'status', ''), 'open'),
         case when coalesce(nullif(x ->> 'status', ''), 'open') = 'open' then null else now() end
    from jsonb_array_elements(coalesce(p -> 'action_items', '[]')) x
   where coalesce(trim(x ->> 'text'), '') <> ''
  on conflict (id) do update set
    text = excluded.text, show_in_prep = excluded.show_in_prep, status = excluded.status,
    closed_at = case when excluded.status = 'open' then null else coalesce(a.closed_at, now()) end,
    deleted_at = null
  where a.source = 'debrief' and a.source_id = v_id;

  return v_id;
end;
$$;

revoke all on function public.save_debrief(jsonb) from public, anon;
grant execute on function public.save_debrief(jsonb) to authenticated;
