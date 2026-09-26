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
sandbox) on `radix-ui` · lucide-react · Supabase (Postgres, Auth, Storage, RLS) · zod 4 ·
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

- 25 user tables in `public`, all with `user_id default auth.uid()`, RLS `user_id = auth.uid()`,
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

## Design

AXIA-style: near-black + one orange accent (`--primary`), `heading-caps` utility for bold
uppercase titles/nav, `Wordmark` component, green/red only for P&L, domain colours fixed in
`globals.css` (`--domain-*`).

## Deploys

`claude/compassionate-cray-ktgp9e` is Vercel's **production** branch: every push deploys live.
Run `pnpm check && pnpm test:db && pnpm build && pnpm e2e` before every push.

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
