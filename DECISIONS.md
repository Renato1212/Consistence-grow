# Decisions log

Format: date — decision — reason.

## Phase 0 — Setup

- 2026-09-26 — Fresh repo `renato1212/consistence-grow`; the older "Infinite Grow" project is not reused. — User asked to build from scratch.
- 2026-09-26 — App name **Consistent Grow**. — User choice.
- 2026-09-26 — New Supabase project `consistent-grow` in eu-west-3 (Paris) on the **Free** plan. — User choice; closest region to Lisbon. Consequence: 50 MB max per uploaded file; larger videos must be added as links (YouTube unlisted / Drive). Free projects pause after ~7 days without activity; daily use prevents it.
- 2026-09-26 — Latest stable majors: Next 16.3, React 19.2, Tailwind 4, zod 4, Vitest 5, TypeScript 5.9. — Spec asks for latest stable.
- 2026-09-26 — shadcn/ui components are hand-written in `src/components/ui` (same Radix + cva code the CLI generates). — `ui.shadcn.com` is blocked by the cloud sandbox egress policy, so the CLI cannot fetch the registry.
- 2026-09-26 — Supabase **publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) instead of the legacy anon JWT. — Current Supabase recommendation; rotatable independently of the JWT secret.
- 2026-09-26 — Single-user lock = `private.allowed_signups` table + `before insert` trigger on `auth.users`. The production email is inserted by hand, not committed. — Works regardless of the dashboard sign-up toggle and cannot be bypassed by the API; keeps personal data out of git.
- 2026-09-26 — Auth: magic link (PKCE via `/auth/callback`) + optional password set in Settings → Account. — Spec §4; password gives a fallback when email is slow.
- 2026-09-26 — Static CSP in `next.config.ts` (with `'unsafe-inline'` scripts) rather than per-request nonces. — Nonces force every page to render dynamically and add a failure mode; the app has no third-party scripts, so the practical risk is low. Revisit if third-party scripts are ever added.
- 2026-09-26 — Route handlers redirect with a relative `Location` header. — Absolute URLs built from the request host (localhost vs 127.0.0.1 / proxies) were blocked by CSP `form-action` in testing.
- 2026-09-26 — CI and all DB/E2E tests run against a **local Supabase stack in Docker** (`supabase start`), never the production project. Test helpers refuse non-local URLs. — Reliability and safety of real data.
- 2026-09-26 — Vercel functions region `cdg1` (Paris). — Same city as Supabase eu-west-3: lowest DB latency.
- 2026-09-26 — Phase-0 shortcuts: `⌘K`, `G then T/J/R/I/P/S`, `N`. `P`, `D` and `/` are wired in the phases that ship prep, debrief and search. — Never ship a shortcut that leads nowhere.
- 2026-09-26 — Header shows Lisbon + New York clocks; the London/NY choice becomes a setting in Phase 1. — Keep Phase 0 minimal.

## Phase 1 — Data foundation + AXIA look

- 2026-09-26 — `claude/compassionate-cray-ktgp9e` is the production branch on Vercel (it was GitHub's default branch when Vercel was linked; neither setting can be changed with the available tools). Every push deploys to production, so the full local suite (unit, DB/RLS, build, E2E) must pass before each push. `main` stays at the Phase 0 snapshot. — Owner asked not to deal with settings; reliability is kept by testing before pushing.
- 2026-09-26 — AXIA-style theme: near-black `#0E0F11`, cards `#16181C`, text `#F2F2F2`, single orange accent `#F28C28` with dark text on orange buttons (8:1 contrast), bold uppercase headings with wide tracking. Domain colours re-tuned (FLOW → violet) so none can be confused with the accent. — Owner chose "black + orange" (axiafutures.com itself is blocked from the build sandbox, so exact brand hex codes could not be copied).
- 2026-09-26 — Contract specs verified by exchange contract maths (tick × multiplier); ZN confirmed via search (½/32 = $15.625). cmegroup.com is blocked from the sandbox. Default fees are 0 until set in Settings — a wrong fee guess would silently corrupt net P&L.
- 2026-09-26 — All derived trade fields are computed by the `compute_trade` trigger (authoritative) and mirrored in `src/lib/trading/pnl.ts` for previews; a DB test proves both agree for every instrument, both directions, all kinds and across DST dates.
- 2026-09-26 — R multiple = net P&L ÷ initial risk in money (|entry − stop| ÷ tick × tick value × contracts). No stop → R is null and `no_stop` is true (spec §6.10). Using net (after fees) keeps R honest.
- 2026-09-26 — Sessions: US = 08:00–17:00 New York, EU = 07:00 London → US start, Asia = the rest; stored in `user_settings` in each session's native zone. Time buckets and weekday use the instrument's exchange zone (CME → Chicago, Eurex → Frankfurt), per spec. Trading day = Lisbon calendar date.
- 2026-09-26 — `fees` holds a manual override; `fees_total` is what was applied (override or instrument default × contracts), so changing size keeps default fees correct.
- 2026-09-26 — Observed moves store ticks and duration but never money (no P&L, no R); missed trades compute hypothetical P&L (what was left on the table).
- 2026-09-26 — Default reference data (instruments, tag vocabulary, the be-flat rule, two draft playbooks, settings) is created per user by `private.seed_user_defaults()` via an `auth.users` trigger and was run once for the existing account. It is the owner's vocabulary, not fake data; no trades/preps/stats are ever seeded.
- 2026-09-26 — "Flat before major scheduled release" is seeded as a rule, not a playbook (spec §6.6 says "as a rule").
- 2026-09-26 — `trade_tags` (pure junction) has no soft delete; deleting the trade or tag cascades.
- 2026-09-26 — Media bucket: private, 50 MB limit (Free plan), images/videos only (png, jpeg, webp, gif, heic/heif, mp4, mov, webm); access only under `user_id/…` paths.
- 2026-09-26 — Migrations are applied to production with the Supabase MCP; local files are renamed to the versions production recorded so `supabase db push`/history stay consistent.
- 2026-09-26 — Treasury prices accept decimal, `110'16`, `110-16`, `110'16.5`, `110'16+` and CME 3-digit (`110'165`, ZT eighths `…'161`); display uses the CME 3-digit form for sub-32nd contracts.
