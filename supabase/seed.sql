-- LOCAL / CI ONLY. Never run against production.
-- Allow the throwaway test accounts used by Playwright and RLS tests.
insert into private.allowed_signups (email) values
  ('e2e@consistent-grow.test'),
  ('intruder@consistent-grow.test'),
  ('perf@consistent-grow.test')
on conflict do nothing;
