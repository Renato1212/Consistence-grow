-- ingest_brief is intentionally callable without a session (it authenticates by
-- API token inside the function); signed-in users never need it.
revoke execute on function public.ingest_brief(text, text, text, date, text) from authenticated;
comment on function public.ingest_brief(text, text, text, date, text) is
  'Token-authenticated ingest for /api/ingest/brief. Anon-callable by design: the caller must present a valid, unrevoked API token (only SHA-256 hashes are stored); it can only write that token owner''s brief row.';
