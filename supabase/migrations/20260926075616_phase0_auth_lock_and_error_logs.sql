-- Phase 0: single-user sign-up lock + server error log.

-- ---------------------------------------------------------------------------
-- Private schema: never exposed through the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Emails allowed to create an account. Production rows are inserted by hand
-- (never committed); local/CI rows come from supabase/seed.sql.
create table private.allowed_signups (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Reject every sign-up whose email is not allow-listed. This works regardless
-- of the dashboard "allow new users to sign up" toggle.
create or replace function private.enforce_allowed_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or not exists (
       select 1 from private.allowed_signups a where a.email = lower(new.email)
     )
  then
    raise exception 'Sign-ups are closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enforce_allowed_signup
  before insert on auth.users
  for each row execute function private.enforce_allowed_signup();

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at current.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- error_logs: server-side failures, shown to the user only as "retry".
-- ---------------------------------------------------------------------------
create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  level text not null default 'error' check (level in ('error', 'warn')),
  source text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb
);

create index error_logs_user_created_idx on public.error_logs (user_id, created_at desc);

alter table public.error_logs enable row level security;

create policy "error_logs: insert own"
  on public.error_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "error_logs: read own"
  on public.error_logs for select to authenticated
  using (user_id = (select auth.uid()));
