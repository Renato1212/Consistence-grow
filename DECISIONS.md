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

- 2026-09-26 — Branch model: `main` = Vercel production; the work branch `claude/compassionate-cray-ktgp9e` = preview deployments and the running PR. Each phase is pushed to the work branch (preview URL for the owner to test) and goes live when the PR is merged into `main`. — Matches spec §12 (preview per phase, then production).
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

## Phase 2 — Trade logging

- 2026-09-26 — New trades get their UUID in the browser before the first save; every autosave is an idempotent `upsert`. — A retried save after a lost response can never create a duplicate trade.
- 2026-09-26 — Autosave engine (`src/lib/autosave/controller.ts`): 1 s debounce, ordered saves, backoff retries 2→30 s, manual retry, every unconfirmed snapshot mirrored to localStorage and cleared only after server confirmation; flush on tab hide; `beforeunload` guard. Incomplete drafts (DB-required fields missing) are kept on the device and offered back ("Restore") on the next /journal/new.
- 2026-09-26 — The trade editor renders client-only (`next/dynamic`, `ssr:false`): it generates the id, reads "now" and local drafts, so server rendering would only cause hydration mismatches.
- 2026-09-26 — A trade is saved as soon as instrument, direction, entry time/price (and size unless observed) are valid; exit and domain are spec-required but may be filled after (open trade). Missing fields are listed next to the save status.
- 2026-09-26 — Prices accept `,` as decimal separator (Portuguese keyboards) and are validated against the instrument tick; Treasuries use the 32nds parser.
- 2026-09-26 — Native `<select>` for dropdowns (OS picker on phones, fully accessible) instead of a custom popover select.
- 2026-09-26 — New deps: `react-hook-form` (+ resolvers) for the form, `@tanstack/react-table` **v9** (current major; `useTable` + explicit `rowSortingFeature`), `tus-js-client` for resumable video uploads (Supabase TUS endpoint, 6 MB chunks).
- 2026-09-26 — Images: original + client-side 480 px WebP thumbnail in the private bucket; HEIC thumbnails are skipped where the browser can't decode them. Videos: TUS resumable upload with progress; files > 50 MB are refused before upload with a link suggestion (YouTube unlisted / Drive). Media pasted before the first save is queued and uploaded as soon as the trade exists.
- 2026-09-26 — Signed URLs (1 h) for private media; YouTube links embed via youtube-nocookie.
- 2026-09-26 — Journal detail opens via `?trade=<id>` (server-loaded, shareable, survives reload). Heatmap sums USD and EUR separately (never mixed) and R only over trades with a stop.
- 2026-09-26 — Trash shows trades deleted in the last 30 days; the hard purge of older items is part of the Phase 8 backup cron (needs the service key).
- 2026-09-26 — The floating "Log trade" button hides on the log/edit pages where it would only cover the form.
- 2026-09-26 — Instrument fees are round-turn per contract and apply to trades saved afterwards (existing trades keep their stored fees until edited). Tick size/value editing is behind an explicit unlock with a warning.

## Phase 3 — Calendar, session prep, Today

- 2026-09-26 — Holidays: editable per-user `holidays` table (markets `US` = NYSE, `UK` = England & Wales bank holidays), seeded 2026–2027 from the NYSE Group calendar and GOV.UK; Settings → Calendar warns when next year is missing. — Spec §6.7 (needs a yearly review); cmegroup/nyse sites are blocked from the sandbox, dates verified via search.
- 2026-09-26 — FLOW rules (unit-tested against published dates): monthly OPEX = 3rd Friday, previous business day if that Friday is a holiday; quad witching = Mar/Jun/Sep/Dec OPEX; VIX = 30 days before next month's SPX expiry (so Tuesday when that Friday is a holiday — e.g. 18 Mar 2025, 19 May 2026), prior business day if the result is a holiday. Month/quarter/year end = US close rebalancing (last NYSE business day, early close respected) + London 4pm WM/R fix (last UK business day).
- 2026-09-26 — Generated rows are keyed by period (`opex:2026-10`, `tpl:<id>:<date>`) and upserted by `sync_generated_events` when Calendar/Prep/Today load: a changed holiday moves the row instead of duplicating it; user edits to notes/importance/instruments and user deletions survive; future rows that are no longer produced (template switched off) are removed unless a trade links to them.
- 2026-09-26 — Session markers (EU cash open 09:00 Frankfurt, US open 09:30 NY, NYSE closing-imbalance publication / MOC cut-off 15:50 NY, close 16:00 NY or early close, imbalance 10 min before) are computed, never stored. — Would otherwise add ~1,000 rows a year and flood the calendar.
- 2026-09-26 — Recurring templates (API Tue, EIA Wed, claims Thu, nat gas Thu) are seeded **off**; occurrences in a week with a US holiday are flagged "verify time" and skipped on the holiday itself. — Agencies move those releases; a silently wrong time would break the be-flat rule.
- 2026-09-26 — Presets live in code (`src/lib/calendar/presets.ts`) with times in the release's own zone (ECB 14:15 CET + 14:45 presser, BoE 12:00 London, FOMC 14:00 ET + 14:30 presser, US data 08:30/10:00 ET, auctions 13:00 ET). BoJ has no fixed time: it's prefilled and flagged. No external calendar API (spec); a feed can later write rows with `source = 'import'`.
- 2026-09-26 — Calendar event edits use an explicit Save (with Retry on failure) rather than autosave: events are short forms, and a half-typed time must not move an event that other trades link to.
- 2026-09-26 — Prep = one snapshot (prep, key levels, scenarios, rule acknowledgements) saved by the `save_prep` RPC in one transaction, client UUIDs, missing rows soft-deleted; autosave engine reused, local mirror keyed by date+session. Levels accept off-tick prices (levels are not orders); Treasuries accept 32nds. Invalid/incomplete level rows stay on the device and are flagged, never sent.
- 2026-09-26 — Levels are sorted strongest-first on load, carry-forward and "Strongest first", not while typing (nothing jumps under the cursor). "Carry forward" copies untested levels from the most recent earlier day with a prep (its US prep if present).
- 2026-09-26 — US "Copy from EU prep" copies context, focus, risk plan, levels (linked via `carried_from_id`) and scenarios; readiness and the brief are session-specific and not copied.
- 2026-09-26 — Today phases from Lisbon time: pre-EU until the EU-prep deadline (08:00 Lisbon), EU until the US session start (08:00 NY), US until the cash close (16:00 NY / early close), then after-close; weekends and days both US and UK are shut are "closed"; on a US holiday the day is EU-only until the Xetra close. The debrief card links to the Journal until Phase 4 ships debriefs.
- 2026-09-26 — Be-flat banner is app-wide (in the shell), reads importance-3 events for the next 26 h from the browser (refresh every 5 min, on focus and after calendar edits) and keeps the last list on a failed read. `event_banner_minutes` (default 10, 0 = off) in Settings → Calendar.
- 2026-09-26 — Calendar is reachable from Today, Prep, the ⌘K palette and Settings, keeping the 5-item nav from the spec. `P` opens `/prep`, which redirects to the prep that matters now (next weekday's EU prep at weekends).
- 2026-09-26 — New deps: `react-markdown` + `remark-gfm` for the pasted brief (raw HTML never rendered).

## Phase 4 — Debrief & weekly review

- 2026-09-26 — Debrief = one snapshot saved by the `save_debrief` RPC in one transaction (debrief row, scenario outcome/traded, level tested/respected, rule checks with notes, action items with client ids). It only touches scenarios/levels of that day's own preps; a second client id for the same day reuses the existing debrief (unique `day_id`).
- 2026-09-26 — "Debrief complete" needs the three pillar grades and a note on every broken rule — enforced in the UI and again in the database (a check in `save_debrief`). Drafts save with anything missing. Went well / to improve are capped at 3 (UI slots + existing DB check).
- 2026-09-26 — Action items stay on Today, in every prep and in the weekly review until marked done or dropped (from any of those places, with Undo). Only items flagged "show in next prep" appear on Today/prep.
- 2026-09-26 — Today after the close shows Start / Continue debrief; on later days a reminder appears for the most recent day in the last week with trades but no completed debrief. `D` opens today's debrief (last weekday's at the weekend).
- 2026-09-26 — Weekly review is generated for any ISO week (Lisbon trading dates), stored input is only the reflection and ≤ 3 goals (`weekly_reviews`, upsert on user+week). Last week's goals show on Today all this week. The AI weekly review is left out until Phase 7 (hidden, not stubbed).
- 2026-09-26 — Honest stats in reviews: R only over trades with a stop (n shown next to it), money per currency, missed/observed never in P&L; rows with n < 10 greyed and "insufficient data" below 20. Equity curve is a single-series inline SVG (2px line, hairline grid, crosshair tooltip, keyboard arrows) with a table fallback.

## Phase 5 — Playbook

- 2026-09-26 — Playbook saves go through the `save_playbook` RPC (fields + checklist + version in one transaction). Versioning rule: a change to structured fields (name, domains, markets, status, summary, the six template sections, checklist) creates version N+1 **once per editing session**; later autosaves in the same session update that version (no version per keystroke); free notes never create a version. Trades keep `playbook_version` from the existing trigger. Existing v1 snapshots were back-filled with the checklist so the first real edit compares like with like.
- 2026-09-26 — Pre-entry checklist results are stored on the trade (`trades.checklist` jsonb, item id → ticked). Nothing is stored until the first tick; then every item is recorded so adherence stats are honest. Changing the playbook clears it.
- 2026-09-26 — `trade_facts` was dropped and recreated (same definition) because it expands `t.*` and must pick up the new column; views hold no data.
- 2026-09-26 — Deviation: free notes are markdown (rendered like the prep brief) and pasted images live in the playbook's pinned-examples gallery, instead of Tiptap. Tiptap images would embed signed URLs of the private bucket that expire inside saved HTML; this is more reliable and needs no new dependency.
- 2026-09-26 — Deviation: playbook charts (R histogram, bars) are plain HTML/SVG; Recharts is deferred to Insights where many charts justify the dependency.
- 2026-09-26 — Playbook stats use only taken trades; expectancy = average R over trades with a stop (n shown); profit factor in R; event proximity buckets −30…0 / 0–5 / 5–15 / 15–60 min (shared with Insights). Examples gallery = linked trades with media, A-process first, then by R.
- 2026-09-26 — Deleted playbooks are soft-deleted and listed under "Recently deleted (30 days)" on the Playbook page with Restore; linked trades keep their link.

## Add-on — Macro Desk brief delivery

- 2026-09-26 — The daily Macro Desk Pre-Session Brief (owner's Claude skill, run by a scheduled routine) is delivered to `POST /api/ingest/brief` with a personal API token (Settings → Integrations). Tokens are generated in the browser, shown once and stored only as SHA-256 hashes; the token is checked inside the `ingest_brief` security-definer function (callable with the publishable key), so the app needs no service key. A token can only write briefs. `/api/ingest` is excluded from the login redirect.
- 2026-09-26 — Briefs live in their own `briefs` table (one per user, Lisbon date and edition; a resend replaces it) instead of writing into preps from the outside. The prep editor fills an empty Brief section automatically; if the section already has different text it shows "New Macro Desk brief — Replace / Keep mine" (owner's choice: never overwrite typed text). Today shows the TL;DR (section 0) of the current edition.
- 2026-09-26 — Delivery runs as weekday routines (≈06:58 Lisbon European-open edition, ≈12:58 Lisbon US refresh) in the Claude Code cloud environment; the environment's network policy must allow the app's domain, and the token is kept as an environment secret, never in the routine prompt.

## Phase 6 — Insights

- 2026-09-26 — Insights maths runs in pure, unit-tested TypeScript (`src/lib/insights`) in the browser over the user's trades (up to 10,000, newest kept), so every filter change is instant and the same functions feed every tab. A single trader's data is small; the pattern finder mines 5,000 generated trades in about a second (unit test). The spec's "aggregates in SQL" stays the plan for the Phase 7 AI payload.
- 2026-09-26 — Fix: PostgREST returns at most 1,000 rows per request, so the Journal's 2,000-trade limit silently stopped at 1,000 and never showed "truncated". Journal and Insights now page through with `fetchAll()` (`src/lib/data/paginate.ts`).
- 2026-09-26 — Statistics: win rate over decided trades (net ≠ 0; R when there is no money) with a Wilson 95% interval; expectancy = mean R over trades with a stop with a percentile bootstrap 95% interval (1,000 resamples, seeded, so numbers don't move between renders); profit factor in R; max drawdown in R and per currency; streaks in entry order (a scratch breaks both). Money is never summed across currencies.
- 2026-09-26 — The filter lives in the URL (shareable, survives reload and tab switches) and saved views store the same object in `saved_views.filter` (validated with zod when read). Playbooks and tags are filtered by name, so a renamed playbook or tag drops out of old saved views. Missed/observed kinds can be included; the page then says the results are hypothetical.
- 2026-09-26 — Pattern finder: every 2- and 3-attribute combination of the spec's attributes (one value per attribute; each tag separately) inside the filter, among trades with R, needing n ≥ `pattern_min_n` (default 8, editable on the tab and saved to settings). An attribute every trade shares and a 3-combination with exactly the same trades as one of its pairs are left out (they add nothing). Ranked by expectancy lift over the baseline; the number of combinations tested is shown next to a "Hypothesis to test" note (multiple-testing warning), never "edge".
- 2026-09-26 — Domain confluence, missed & observed live in the Pattern finder tab as the spec lists them. Missed/observed ignore the Kinds filter but follow every other constraint. Observed moves are profiled by trigger domain, time, event proximity, instrument or weekday (median |ticks| and duration).
- 2026-09-26 — Process 2×2 uses the process grade (A/B good, C/F bad) against the net result; ungraded and scratch trades are counted as excluded. Mistake costs use tags from groups of kind "mistake". Rule violations come from debrief rule checks per ISO week. Plan accuracy uses scenarios/levels of preps in the date range (and the instrument filter); level respect counts tested levels only.
- 2026-09-26 — Charts: Recharts (equity curve in R or one currency, R histogram, expectancy bars with bootstrap interval whiskers); heatmaps, the confluence matrix and the 2×2 are HTML grids. Green/red only for P&L (R and money), the accent for the equity line, no new categorical palette. Every bar, cell and row opens a side sheet with its trades, each linking to the Journal detail.
- 2026-09-26 — New deps: `recharts`. New UI primitive: `popover` (radix). The AI Analysis tab stays hidden until Phase 7.
