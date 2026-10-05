-- Daily routine RPCs: per-block day state, 60-second prep, 2-minute debrief.

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

