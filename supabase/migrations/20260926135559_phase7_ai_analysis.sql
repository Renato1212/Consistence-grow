-- Phase 7: AI analysis on the owner's Claude subscription. The app never calls
-- Claude: a scheduled Claude Code routine reads a queue of analysis requests
-- (with ready-made payloads) and posts structured findings back, authenticated
-- by a personal API token with the "ai" scope.

-- ---------------------------------------------------------------------------
-- Token scopes: existing tokens keep delivering briefs only.
-- ---------------------------------------------------------------------------
alter table public.api_tokens
  add column scopes text[] not null default '{briefs}'
    check (cardinality(scopes) >= 1 and scopes <@ array['briefs', 'ai']::text[]);

-- Resolve a token's owner for one scope (or raise 28000) and stamp its use.
create or replace function private.token_owner(p_token text, p_scope text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_user uuid;
begin
  select t.user_id into v_user
    from public.api_tokens t
   where t.token_hash = v_hash
     and t.revoked_at is null and t.deleted_at is null
     and p_scope = any (t.scopes);
  if v_user is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  update public.api_tokens set last_used_at = now() where token_hash = v_hash;
  return v_user;
end;
$$;
revoke all on function private.token_owner(text, text) from public, anon, authenticated;

-- Briefs now require the "briefs" scope (every existing token has it).
create or replace function public.ingest_brief(
  p_token text,
  p_session text,
  p_markdown text,
  p_date date default null,
  p_source text default 'macro-desk'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'briefs');
  v_date date := coalesce(p_date, (now() at time zone 'Europe/Lisbon')::date);
  v_id uuid;
begin
  if p_session not in ('EU', 'US') then
    raise exception 'edition must be EU or US' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_markdown)), 0) = 0 or length(p_markdown) > 200000 then
    raise exception 'markdown must be 1–200000 characters' using errcode = '22023';
  end if;

  insert into public.briefs (user_id, date, session, source, markdown, received_at)
  values (v_user, v_date, p_session, coalesce(nullif(trim(p_source), ''), 'macro-desk'), p_markdown, now())
  on conflict (user_id, date, session) where deleted_at is null
  do update set markdown = excluded.markdown, source = excluded.source, received_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'date', v_date, 'session', p_session);
end;
$$;

-- ---------------------------------------------------------------------------
-- Analysis requests (the queue) and results
-- ---------------------------------------------------------------------------
alter table public.ai_insights drop constraint ai_insights_scope_check;
alter table public.ai_insights
  add constraint ai_insights_scope_check check (scope in ('filter', 'weekly', 'session')),
  add column label text,
  add column filter_key text,
  add column week text check (week ~ '^\d{4}-W\d{2}$'),
  add column request_id uuid;

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null check (kind in ('filter', 'weekly', 'session')),
  slot text check (slot in ('eu', 'us', 'weekly')),
  label text not null check (length(label) between 1 and 200),
  filter jsonb not null default '{}'::jsonb,
  filter_key text not null default '',
  week text check (week ~ '^\d{4}-W\d{2}$'),
  status text not null default 'pending' check (status in ('pending', 'served', 'done', 'failed')),
  data_hash text,
  allowed_trade_ids uuid[] not null default '{}',
  allowed_playbook_ids uuid[] not null default '{}',
  served_at timestamptz,
  completed_at timestamptz,
  insight_id uuid references public.ai_insights (id) on delete set null,
  error text
);
alter table public.ai_requests enable row level security;
create policy "ai_requests: owner" on public.ai_requests for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create trigger set_updated_at before update on public.ai_requests
  for each row execute function public.set_updated_at();
create index ai_requests_user_idx on public.ai_requests (user_id);
create index ai_requests_open_idx on public.ai_requests (user_id, status)
  where deleted_at is null and status in ('pending', 'served');
create index ai_requests_insight_idx on public.ai_requests (insight_id);
create index ai_insights_request_idx on public.ai_insights (request_id);
create index ai_insights_created_idx on public.ai_insights (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Token-authenticated functions for the analysis routine. Anon-callable by
-- design (no user session): each resolves the token's owner through
-- private.token_owner(…, 'ai') and only ever reads or writes that owner's rows.
-- ---------------------------------------------------------------------------

-- Everything the app needs to build payloads for the owner (trades newest
-- first, capped; long text trimmed).
create or replace function public.ai_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
begin
  return jsonb_build_object(
    'trades', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.entry_at)
        from (
          select id, kind, trade_date, entry_at, updated_at, symbol, currency, direction, net_pnl,
                 r_multiple, ticks, duration_sec, session, weekday, time_bucket, primary_domain,
                 secondary_domains, domain_count, playbook_id, playbook_name, playbook_version,
                 minutes_from_event, event_category, event_title, level_type, level_strength,
                 scenario_id, key_level_id, regime, prior_day_type, prep_done, readiness,
                 confidence, grade_context, grade_edge, grade_process, exit_reason, tag_ids,
                 tag_names, left(thesis, 500) as thesis, left(lesson, 500) as lesson
            from public.trade_facts
           where user_id = v_user
           order by entry_at desc
           limit 10000
        ) f), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'group', g.name, 'kind', g.kind))
        from public.tags t
        join public.tag_groups g on g.id = t.group_id and g.deleted_at is null
       where t.user_id = v_user and t.deleted_at is null), '[]'::jsonb),
    'playbooks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'version', p.version,
               'primary_domain', p.primary_domain, 'status', p.status) order by p.name)
        from public.playbooks p
       where p.user_id = v_user and p.deleted_at is null), '[]'::jsonb),
    'scenarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'date', d.date, 'session', sp.session, 'instrument', i.symbol,
               'direction', s.direction, 'primary_domain', s.primary_domain,
               'outcome', s.outcome, 'traded', s.traded,
               'text', left(concat_ws(' → ', nullif(s.if_text, ''), nullif(s.then_text, '')), 300)))
        from public.scenarios s
        join public.session_preps sp on sp.id = s.prep_id and sp.deleted_at is null
        join public.trading_days d on d.id = sp.day_id
        left join public.instruments i on i.id = s.instrument_id
       where s.user_id = v_user and s.deleted_at is null), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'date', d.date, 'instrument', i.symbol, 'level_type', k.level_type,
               'strength', k.strength, 'tested', k.tested, 'respected', k.respected))
        from public.key_levels k
        join public.session_preps sp on sp.id = k.prep_id and sp.deleted_at is null
        join public.trading_days d on d.id = sp.day_id
        join public.instruments i on i.id = k.instrument_id
       where k.user_id = v_user and k.deleted_at is null), '[]'::jsonb),
    'rule_checks', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.date, 'rule', r.text, 'followed', c.followed))
        from public.rule_checks c
        join public.trading_days d on d.id = c.day_id
        join public.rules r on r.id = c.rule_id
       where c.user_id = v_user and c.context = 'debrief' and c.deleted_at is null), '[]'::jsonb),
    'debriefs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.date, 'grade_context', b.grade_context, 'grade_edge', b.grade_edge,
               'grade_process', b.grade_process, 'went_well', b.went_well,
               'to_improve', b.to_improve, 'lesson', left(b.lesson, 500),
               'complete', b.completed_at is not null) order by d.date)
        from public.debriefs b
        join public.trading_days d on d.id = b.day_id
       where b.user_id = v_user and b.deleted_at is null
         and d.date >= (now() at time zone 'Europe/Lisbon')::date - 120), '[]'::jsonb),
    'weekly_reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', format('%s-W%s', w.iso_year, lpad(w.iso_week::text, 2, '0')),
               'reflection', left(w.reflection, 2000), 'goals', w.goals))
        from public.weekly_reviews w
       where w.user_id = v_user and w.deleted_at is null), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', h.date, 'market', h.market, 'name', h.name,
               'early_close', to_char(h.early_close, 'HH24:MI')))
        from public.holidays h
       where h.user_id = v_user and h.deleted_at is null), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at)
        from (
          select id, kind, slot, label, filter, filter_key, week, status, created_at
            from public.ai_requests
           where user_id = v_user and deleted_at is null and status in ('pending', 'served')
        ) q), '[]'::jsonb),
    'recent_hashes', coalesce((
      select jsonb_agg(distinct a.data_hash)
        from public.ai_insights a
       where a.user_id = v_user and a.deleted_at is null
         and a.created_at > now() - interval '60 days'), '[]'::jsonb),
    'pattern_min_n', coalesce((
      select s.pattern_min_n from public.user_settings s where s.user_id = v_user), 8)
  );
end;
$$;

-- Queue a scheduled request (idempotent per filter and week while open).
create or replace function public.ai_enqueue(
  p_token text,
  p_kind text,
  p_slot text,
  p_label text,
  p_filter jsonb,
  p_filter_key text,
  p_week text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
  v_id uuid;
begin
  select id into v_id
    from public.ai_requests
   where user_id = v_user and deleted_at is null and status in ('pending', 'served')
     and kind = p_kind and filter_key = coalesce(p_filter_key, '')
     and week is not distinct from p_week
   limit 1;
  if v_id is null then
    insert into public.ai_requests (user_id, kind, slot, label, filter, filter_key, week)
    values (v_user, p_kind, p_slot, p_label, coalesce(p_filter, '{}'::jsonb),
            coalesce(p_filter_key, ''), p_week)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Hand a request to the routine: record the data version and the ids its
-- payload contained (the only ones findings may cite).
create or replace function public.ai_serve(
  p_token text,
  p_request uuid,
  p_data_hash text,
  p_trade_ids uuid[],
  p_playbook_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
begin
  update public.ai_requests
     set status = 'served', served_at = now(), data_hash = p_data_hash,
         allowed_trade_ids = coalesce(p_trade_ids, '{}'),
         allowed_playbook_ids = coalesce(p_playbook_ids, '{}'), error = null
   where id = p_request and user_id = v_user and deleted_at is null
     and status in ('pending', 'served');
  if not found then
    raise exception 'request not found or already completed' using errcode = 'P0002';
  end if;
end;
$$;

-- Mark a request as not analysable (e.g. no trades in its filter).
create or replace function public.ai_fail(p_token text, p_request uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
begin
  update public.ai_requests
     set status = 'failed', completed_at = now(), error = left(coalesce(p_error, 'failed'), 500)
   where id = p_request and user_id = v_user and deleted_at is null
     and status in ('pending', 'served');
end;
$$;

-- Store findings for a served request. Evidence must come from the payload.
create or replace function public.ai_submit(
  p_token text,
  p_request uuid,
  p_data_hash text,
  p_output jsonb,
  p_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.token_owner(p_token, 'ai');
  r public.ai_requests;
  v_bad text;
  v_id uuid;
begin
  select * into r
    from public.ai_requests
   where id = p_request and user_id = v_user and deleted_at is null
   for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  -- A retried post after success is a no-op.
  if r.status = 'done' and r.data_hash = p_data_hash and r.insight_id is not null then
    return r.insight_id;
  end if;
  if r.status <> 'served' then
    raise exception 'request is not open (status %) — fetch the queue again', r.status
      using errcode = '22023';
  end if;
  if r.data_hash is distinct from p_data_hash then
    raise exception 'data changed since the payload was built — fetch the queue again'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_output -> 'findings') is distinct from 'array' then
    raise exception 'output.findings must be an array' using errcode = '22023';
  end if;

  select string_agg(distinct e.value, ', ') into v_bad
    from jsonb_array_elements(p_output -> 'findings') f,
         jsonb_array_elements_text(coalesce(f.value -> 'evidence_trade_ids', '[]'::jsonb)) e
   where case when e.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then not (e.value::uuid = any (r.allowed_trade_ids))
              else true end;
  if v_bad is not null then
    raise exception 'evidence_trade_ids not in the payload: %', v_bad using errcode = '22023';
  end if;

  select string_agg(distinct p.value, ', ') into v_bad
    from jsonb_array_elements(p_output -> 'findings') f,
         lateral (select f.value ->> 'related_playbook_id' as value) p
   where p.value is not null
     and case when p.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then not (p.value::uuid = any (r.allowed_playbook_ids))
              else true end;
  if v_bad is not null then
    raise exception 'related_playbook_id not in the payload: %', v_bad using errcode = '22023';
  end if;

  insert into public.ai_insights
    (user_id, scope, filter, data_hash, model, output, label, filter_key, week, request_id)
  values
    (v_user, r.kind, r.filter, p_data_hash, left(coalesce(nullif(trim(p_model), ''), 'claude'), 100),
     p_output, r.label, r.filter_key, r.week, r.id)
  returning id into v_id;

  update public.ai_requests
     set status = 'done', completed_at = now(), insight_id = v_id, error = null
   where id = r.id;
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ai_context(text)',
    'public.ai_enqueue(text, text, text, text, jsonb, text, text)',
    'public.ai_serve(text, uuid, text, uuid[], uuid[])',
    'public.ai_fail(text, uuid, text)',
    'public.ai_submit(text, uuid, text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to anon', f);
    execute format(
      'comment on function %s is %L', f,
      'Token-authenticated (scope "ai") for the AI-analysis routine via /api/ai/*. Anon-callable by design: the caller must present a valid, unrevoked API token with the ai scope; it only reads or writes that token owner''s rows.');
  end loop;
end $$;

-- Append a note to a playbook's free notes (no new version; used by
-- "Add note to playbook" on AI findings). Runs as the signed-in user.
create or replace function public.append_playbook_note(p_playbook uuid, p_text text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.playbooks
     set notes_md = case
                      when coalesce(trim(notes_md), '') = '' then p_text
                      else notes_md || E'\n\n' || p_text
                    end
   where id = p_playbook and deleted_at is null
     and coalesce(length(trim(p_text)), 0) between 1 and 5000
  returning true;
$$;
revoke all on function public.append_playbook_note(uuid, text) from public;
grant execute on function public.append_playbook_note(uuid, text) to authenticated;
