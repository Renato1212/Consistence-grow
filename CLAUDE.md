@AGENTS.md

# Consistent Grow — project guide for Claude sessions

Single-user trading journal & edge lab for a discretionary futures day trader in Lisbon.
Full product spec: `docs/BUILD_SPEC.md`. Decisions log: `DECISIONS.md` (append one dated line
per non-obvious choice).

## Non-negotiables (from the spec — they override feature work)

1. Reliability over features. Half-working → hide it. No flaky UI.
2. Never lose data: debounced autosave (~1 s) with visible Saved/Saving…/Error-retry; soft
   deletes (30-day trash).
3. Honest statistics: always show n; grey out n < 10; "insufficient data" badge n < 20; CIs.
4. No fake data in production. Seeds for dev live in `supabase/seed.sql` (local only).
5. Every phase ends typechecked, linted, tested, committed and deployed to a Vercel preview.

## Stack

Next.js 16 (App Router, `src/`, Turbopack) · React 19 · TypeScript strict · Tailwind v4 ·
shadcn-style components hand-written in `src/components/ui` (registry is blocked in the cloud
sandbox) on `radix-ui` · lucide-react · Recharts · Supabase (Postgres, Auth, Storage, RLS) · zod 4 ·
date-fns + date-fns-tz · Vitest 5 · Playwright · pnpm.

Next 16 differences that matter here: `middleware.ts` is now **`src/proxy.ts`** (export
`proxy`); `params`/`searchParams`/`cookies()` are async; typed `PageProps<"/route">` and
`LayoutProps<"/">` helpers come from `next typegen`.

## Commands

| Task                | Command                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| Dev server          | `pnpm dev`                                                                              |
| All fast checks     | `pnpm check` (typecheck, lint, prettier, unit)                                          |
| Unit tests          | `pnpm test`                                                                             |
| Local Supabase      | `pnpm db:start` / `pnpm db:stop` / `pnpm db:reset` (needs Docker)                       |
| DB / RLS tests      | `pnpm test:db` (local stack only — refuses non-local URLs)                              |
| E2E                 | `pnpm build && pnpm e2e` (needs local stack; set `PW_CHROMIUM_PATH` in cloud sandboxes) |
| Regenerate DB types | `pnpm db:types`                                                                         |

Cloud sandbox: Docker daemon may need `sudo dockerd &` before `pnpm db:start`.

## Architecture

- `src/app/(app)/*` — authenticated pages; `(app)/layout.tsx` renders the shell (top nav,
  mobile bottom nav, ⌘K palette, shortcuts, floating "Log trade") and re-verifies the user.
- `src/app/login`, `src/app/auth/{callback,signout}` — auth (magic link PKCE + password).
- `src/proxy.ts` → `src/lib/supabase/proxy.ts` — refreshes the session cookie, redirects
  unauthenticated requests to `/login?next=…`.
- `src/lib/supabase/{client,server}.ts` — browser/server Supabase clients.
- `src/lib/time.ts` — all time zone logic. Store UTC; display Europe/Lisbon; define session
  times in their native zone (NY/London) so DST gaps resolve automatically.
- `src/lib/domains.ts` — the five Axia edge domains + fixed colours (CSS tokens
  `--domain-*` in `globals.css`).
- `src/lib/errors.ts` — `logServerError()` writes to `error_logs`; users only see "retry".
- `supabase/migrations` — schema; every table has RLS `user_id = auth.uid()`.
  `private.allowed_signups` + trigger on `auth.users` enforce the single-user lock.

## Data model (Phase 1)

- 25 user tables in `public` (27 after Phase 3, 28 after Phase 7, 32 with Statements), all with `user_id default auth.uid()`, RLS `user_id = auth.uid()`,
  `updated_at` trigger and (except `trade_tags`) `deleted_at` soft delete. See
  `supabase/migrations/*_phase1_core.sql`.
- `public.compute_trade()` trigger derives ticks, fees_total, gross/net P&L, risk, R, duration,
  weekday, time bucket, session, trading day, playbook version, minutes from event. The TS
  mirror is `src/lib/trading/pnl.ts` (+ `sessions.ts`); `tests/db/trade-compute.test.ts` keeps
  them identical — change both together.
- `public.trade_facts` (security_invoker view) = trade + instrument + tags + event + prep
  context, for Insights.
- `private.seed_user_defaults(uid)` creates instruments, tags, rules, draft playbooks and
  settings for new users (trigger on `auth.users`). Specs mirror `src/lib/trading/instrument-specs.ts`.
- Storage bucket `media` (private, 50 MB): paths `user_id/owner_type/owner_id/file`.
- Typed clients: `src/lib/supabase/database.types.ts` (regenerate with `pnpm db:types` after
  every migration); helpers `Row<"trades">` etc. in `src/lib/supabase/types.ts`.
- Production migrations: apply with the Supabase MCP, then rename the local file to the version
  production recorded (`list_migrations`).

## Trade logging (Phase 2)

- Editor: `src/components/trade/trade-editor.tsx` (client-only via `editor-client.tsx`), form model
  and form↔DB conversion in `src/lib/trading/trade-form.ts`, autosave in
  `src/lib/autosave/controller.ts` (idempotent upserts keyed by a client UUID; drafts in
  localStorage under `cg:trade:<id>`).
- Media: `src/components/trade/media-manager.tsx` (+ `MediaGallery`, `MediaLightbox`), rules in
  `src/lib/media.ts`, signed URLs from `src/lib/data/media.ts`.
- Journal: `/journal` (list + heatmap + `?trade=` detail sheet), `/journal/[id]` (edit),
  `/journal/trash`; data in `src/lib/data/journal.ts` (reads `trade_facts`).
- Settings → Instruments: `/settings/instruments` (fees, active, tick specs behind unlock).
- UI primitives are hand-written in `src/components/ui` (native select, segmented radio group,
  sheet, table…). TanStack Table is **v9** (`useTable`, features via `tableFeatures`).
- E2E helpers `e2e/helpers.ts`: `signIn`, `logTrade`, `pasteImage`, `fillQuickTrade`.

## Calendar, prep, Today (Phase 3)

- Calendar: `/calendar?view=month|week|day&date=`, components in `src/components/calendar`
  (event sheet, quick-add presets, headline log). Pure rules in `src/lib/calendar`:
  `flow.ts` (OPEX/quad/VIX/month-end/fix), `holidays.ts` (seed list mirrored by
  `private.seed_phase3_defaults`), `presets.ts`, `templates.ts`, `markers.ts` (computed session
  markers). Server loaders in `src/lib/data/calendar.ts`; `syncGenerated()` calls the
  `sync_generated_events` RPC (idempotent, keyed by `generator_key`).
- Prep: `/prep/[date]/[eu|us]` (client-only editor `src/components/prep/prep-editor.tsx`), form model
  `src/lib/prep/prep-form.ts`, loader `src/lib/data/prep.ts`, saved via the `save_prep` RPC (one
  transaction). `/prep` redirects to the current session's prep (`P` shortcut).
- Today: `src/lib/today/state.ts` (phase machine, DST-tested), `banner.ts`; page
  `src/app/(app)/today/page.tsx`, plan view `src/components/today/plan-view.tsx`. The be-flat
  banner (`src/components/today/be-flat-banner.tsx`) lives in the app shell; call
  `notifyCalendarChanged()` after writing events.
- Settings → Calendar & sessions: `/settings/calendar` (session times, banner minutes, templates,
  holidays).
- Trade editor links (event / scenario / key level of the entry day): `src/components/trade/trade-links.tsx`.
- New tables: `holidays`, `calendar_templates` (27 user tables in total).

## Debrief & weekly review (Phase 4)

- Debrief: `/review/[date]` (client-only editor `src/components/review/debrief-editor.tsx`, local
  mirror `cg:debrief:<date>`), form model `src/lib/review/debrief-form.ts`, loader
  `src/lib/data/debrief.ts`, saved via the `save_debrief` RPC. `/review/today` redirects to the
  current day (`D` shortcut).
- Weekly review: `/review/week/2026-W40` (`src/lib/data/week.ts`, ISO helpers in
  `src/lib/calendar/dates.ts`), reflection/goals autosaved into `weekly_reviews`. `/review` lists
  recent days and the last 8 weeks.
- Stats: `src/lib/review/stats.ts` (`summarize`, `breakdown`, `equityCurve`, `extremes`,
  `sampleQuality`) — shared by debrief, weekly review and later Insights.
- Action items: `src/components/review/action-items-list.tsx` (done/drop + Undo), used on Today,
  prep, debrief and weekly review.

## Playbook (Phase 5)

- `/playbook` (domain landing with live stats), `/playbook/new?domain=`, `/playbook/[id]` (tabs:
  Playbook read/edit, Stats, History, Examples). Editor `src/components/playbook/playbook-editor.tsx`
  (client-only, autosave via the `save_playbook` RPC with a per-mount edit session id).
- Pure logic in `src/lib/playbook`: `form.ts` (model ↔ payload), `diff.ts` (LCS line diff +
  snapshot field diff), `stats.ts` (expectancy, profit factor, R histogram, buckets, adherence,
  example order). Loader `src/lib/data/playbook.ts`.
- Trade editor shows the linked playbook's checklist (`src/components/trade/trade-checklist.tsx`),
  stored in `trades.checklist`.

## Insights (Phase 6)

- `/insights` (server loader `src/lib/data/insights.ts`, paginated via `src/lib/data/paginate.ts`) →
  client `src/components/insights/insights-view.tsx`. Tabs: Overview, Breakdowns, Pattern finder
  (+ confluence, missed & observed), Process, Plan accuracy. Filter, tab and breakdown dimension
  live in the URL (`src/lib/insights/filters.ts`, `view-state.ts`); saved views in `saved_views`.
- Pure logic in `src/lib/insights`: `metrics.ts` (Wilson, seeded bootstrap, drawdown, streaks,
  equity, histogram), `dimensions.ts` (one definition per attribute for filters, breakdowns and
  patterns), `analysis.ts` (breakdowns, time × weekday heatmap, pattern finder, confluence,
  process, plan accuracy). Unit tests in `insights.test.ts`.
- Charts: Recharts (`src/components/insights/charts.tsx`); every number opens the trade list sheet
  (`DrillContext` in `bits.tsx`). `pattern_min_n` is edited on the Pattern finder tab.

## AI analysis (Phase 7) — Claude subscription, no API

- The app never calls Claude. A Claude Code routine (see `docs/AI_ROUTINE.md`) polls
  `GET /api/ai/queue?slot=eu|us|weekly` and posts `POST /api/ai/findings` with a token of scope `ai`
  (Settings → Integrations). Routes: `src/app/api/ai/*`; token-auth SQL functions `ai_context`,
  `ai_enqueue`, `ai_serve`, `ai_submit`, `ai_fail` (migration `*_phase7_ai_analysis.sql`).
- Pure logic in `src/lib/ai`: `requests.ts` (filter/session/weekly specs, slots), `payload.ts`
  (payload from the Insights libs, trade selection, `specHash`), `schema.ts` (zod output + JSON
  schema), `instructions.ts` (rules; bump `PAYLOAD_VERSION` in `hash.ts` when they change),
  `schedule.ts`. Loader `src/lib/data/ai.ts`.
- UI: Insights "AI analysis" tab (`src/components/insights/ai-tab.tsx`), weekly review
  (`src/components/ai/weekly-ai.tsx`), Today pre-session notes (`src/components/today/ai-notes.tsx`),
  finding cards with action item / playbook note (`src/components/ai/finding-card.tsx`).

## Import / export / backups (Phase 8)

- Import: `/settings/import` (client `src/components/import/import-wizard.tsx`). Pure logic in
  `src/lib/import`: `csv.ts` (parser), `parse.ts` (mapping, symbols, timestamps, prices → fills),
  `group.ts` (flat-to-flat round trips), `hash.ts`, `plan.ts` (dedupe + RPC payload), `preset.ts`.
  Commit via the `import_trades` RPC (one transaction); `needs_review` cleared by trigger when a
  domain is set; Journal `?review=1`.
- Export: `/api/export` (zip, `src/lib/export/build.ts`, tables in `src/lib/export/tables.ts` —
  add new user tables there). Backups: `/api/backup` (manual), `/api/cron/backup` (Vercel Cron in
  `vercel.json`, needs `CRON_SECRET` + `SUPABASE_SECRET_KEY`), bucket `backups`, `purge_trash`.
  UI: `/settings/data`.

## Broker statements (Axia daily PDF)

- Pages: `/statements` (dashboard, `?account=&range=30|90|ytd|all`), `/statements/upload`, `/statements/[id]`,
  `/settings/statements` (product code → instrument map). Components in `src/components/statements`.
- Pure logic in `src/lib/statements`: `layout.ts` (text runs → lines), `axia.ts` (parser), `checks.ts`
  (self-checks → ok/attention), `products.ts` (Axia codes, price scale, implied multiplier), `payload.ts`
  (PDF → RPC payload, one path for upload/API/tests), `analysis.ts` (day stats, products, size, process,
  reconciliation), `dashboard.ts`. `extract.ts` uses `unpdf`; `server.ts` is server-only.
- Routes: `POST /api/statements` (session; `mode=preview|save`, `replace=1`), `POST /api/ingest/statement`
  (token scope `statements`, raw PDF body). SQL: `save_statement`, `ingest_statement`, `map_statement_code`,
  `ai_statements` (migration `*_statements.sql`); bucket `statements`.
- Test fixture: `tests/fixtures/axia-statement.ts` builds anonymised PDFs with the real layout. Never commit a
  real statement.

## Hardening (Phase 9)

- Perf check: `PERF=1 pnpm e2e e2e/perf.spec.ts` (local perf user, 5,000 trades + 250 statements,
  3 s budget per page). Long lists render in pages ("Show more").
- Accessibility: `e2e/a11y.spec.ts` (axe, both themes) must stay at 0 violations. Accent/warning TEXT
  uses `text-primary-ink` / `text-warn` (never `text-primary` / `text-amber-*`); weak samples use
  `weakClass()` (muted text, not opacity). Mobile overflow check in `e2e/mobile.spec.ts`.
- Settings → Tags (`src/components/settings/tag-manager.tsx`; `merge_tags`/`unmerge_tags`/`tag_usage`,
  `tags.archived_at`) and Settings → Rules (`rule-manager.tsx`). Loader `src/lib/data/taxonomy.ts`.
- Restore: `restore_rows` RPC + `src/lib/export/restore.ts` (plan) + Settings → Data card; drill in
  `tests/db/restore.test.ts`. New user tables must be added to `restore_rows`' allow-list too.
- Token endpoints check `token_valid(token, scope)` before doing work. User guide: `USER_GUIDE.md`.

## Macro Desk brief delivery

- `POST /api/ingest/brief` (`src/app/api/ingest/brief/route.ts`), bearer token from Settings →
  Integrations (`/settings/integrations`); token check in `public.ingest_brief` (security definer,
  hashed tokens in `api_tokens`); briefs in `briefs` (one per date + EU/US edition).
- Prep editor auto-fills an empty Brief and offers "Replace / Keep mine" otherwise; Today shows the
  TL;DR via `src/lib/briefs/tldr.ts`. Loader: `src/lib/data/briefs.ts`.

## Design

AXIA-style: near-black + one orange accent (`--primary`), `heading-caps` utility for bold
uppercase titles/nav, `Wordmark` component, green/red only for P&L, domain colours fixed in
`globals.css` (`--domain-*`).

## Deploys

`main` = Vercel production. Work happens on `claude/compassionate-cray-ktgp9e` (every push →
preview URL) via the running PR; merging into `main` ships to production. Run
`pnpm check && pnpm test:db && pnpm build && pnpm e2e` before every push.

## Conventions

- Server-only modules import `"server-only"`. Secrets never get a `NEXT_PUBLIC_` prefix.
- Redirects from route handlers use `relativeRedirect()` (absolute URLs can break CSP).
- Post-login destinations go through `safeNextPath()`.
- Numbers: `num` utility (tabular monospace). R before $. Green/red only for P&L.
- Tests: unit tests next to the code (`*.test.ts`); DB tests in `tests/db`; E2E in `e2e/`.
- Prettier (100 cols, tailwind class sorting) is enforced in CI.

## Environments

- Production Supabase: project `consistent-grow` (ref `aggkqntufwbjvutsmzdh`, eu-west-3,
  Free plan → 50 MB per upload). Migrations are applied via the Supabase MCP / CLI; CI never
  touches production.
- Vercel: team `renato1212's projects`, functions region `cdg1` (Paris).
