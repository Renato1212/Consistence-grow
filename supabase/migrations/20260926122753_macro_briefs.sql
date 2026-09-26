-- Macro Desk briefs delivered by an external job (the macro-desk skill run by
-- a scheduled routine) through /api/ingest/brief, authenticated by a personal
-- API token. Tokens are stored as SHA-256 hashes only.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  date date not null,
  session text not null check (session in ('EU', 'US')),
  source text not null default 'macro-desk',
  markdown text not null check (length(markdown) between 1 and 200000),
  received_at timestamptz not null default now()
);
create unique index briefs_user_date_session_uidx
  on public.briefs (user_id, date, session) where deleted_at is null;

do $$
declare
  t text;
begin
  foreach t in array array['api_tokens', 'briefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%1$s: owner" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('create index %1$s_user_idx on public.%1$I (user_id)', t);
  end loop;
end $$;

-- Token-authenticated ingest (called by the app's /api/ingest/brief route with
-- the publishable key; there is no user session). Security definer so it can
-- resolve the token's owner; it only ever writes that owner's brief row.
-- One brief per user, date and edition: a resend replaces it.
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
  v_user uuid;
  v_date date := coalesce(p_date, (now() at time zone 'Europe/Lisbon')::date);
  v_id uuid;
begin
  select t.user_id into v_user
    from public.api_tokens t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and t.revoked_at is null and t.deleted_at is null;
  if v_user is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  if p_session not in ('EU', 'US') then
    raise exception 'edition must be EU or US' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_markdown)), 0) = 0 or length(p_markdown) > 200000 then
    raise exception 'markdown must be 1–200000 characters' using errcode = '22023';
  end if;

  update public.api_tokens set last_used_at = now()
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  insert into public.briefs (user_id, date, session, source, markdown, received_at)
  values (v_user, v_date, p_session, coalesce(nullif(trim(p_source), ''), 'macro-desk'), p_markdown, now())
  on conflict (user_id, date, session) where deleted_at is null
  do update set markdown = excluded.markdown, source = excluded.source, received_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'date', v_date, 'session', p_session);
end;
$$;

revoke all on function public.ingest_brief(text, text, text, date, text) from public;
grant execute on function public.ingest_brief(text, text, text, date, text) to anon, authenticated;
