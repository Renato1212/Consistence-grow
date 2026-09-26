# BUILD SPEC — Trading Journal & Edge Lab (working name: "Edge Journal")

You are the lead engineer building a production web application for one user: me, Renato, a professional discretionary futures day trader based in Lisbon. You will take this from an empty repository to a deployed, tested app I use every trading day.

Read this whole document before writing any code. Then follow the build phases in section 12 in order.

---

## 0. Before you start — ask me these in ONE message, then proceed

1. **Fresh repo or existing one?** I already have a started project called "Infinite Grow" (repo `github.com/Renato1212/Infinite-grow`, Supabase project `deliberate-practice` in eu-west-3, Vercel project `deliberate-practice`). Ask whether to build on it (audit it first and tell me what you'd keep/discard) or start a new repo.
2. **Supabase plan** (Free vs Pro) — it determines the max upload size for videos (Free = 50 MB per file).
3. **Login email** for my single user account.
4. **A sample trade export CSV** from Rithmic R|Trader Pro and/or MotiveWave so you can build the importer against real data. If I don't have one yet, build the importer's mapping UI and skip presets.
5. **App name** (default: "Edge Journal").

For anything else not specified here, make a sensible decision, log it in `DECISIONS.md` (date, decision, reason), and keep going. Do not stall on minor choices.

---

## 1. Mission

A calm, fast, reliable daily workspace that covers my whole trading loop:

1. **Prepare** each session (EU and US).
2. **Log** every trade (and every missed or observed opportunity) with tags, notes, photos and videos.
3. **Debrief** each day, with lessons and actions that carry forward into the next preparation.
4. **Analyse** everything with filters and intelligent pattern detection to find new edges, weaknesses, and combinations of conditions that work.
5. **Build and maintain my playbooks** organised inside the five Axia Futures edge domains.

The goal is **only what matters most**. The app exists to keep me consistent and organised, never overwhelmed.

---

## 2. Non-negotiable principles (these override everything else)

1. **Reliability over features.** I prefer fewer features to any inconsistent behaviour. A feature ships only when it works every time. If something is half-working, remove it or hide it behind a flag — never leave it visible and flaky.
2. **Never lose data.** Every form autosaves (debounced, ~1s) to the database, with a visible "Saved" / "Saving…" / "Error — retry" indicator. Failed saves retry and are never silently dropped. Deletions are soft (trash with restore for 30 days).
3. **Speed of capture.** Logging a trade must take under 60 seconds for the required fields. Only instrument, direction, entry, exit, size and domain are required; everything else is optional and can be filled later.
4. **One obvious next action.** Every screen has one primary action. No dashboards full of widgets I didn't ask for.
5. **Progressive disclosure.** Advanced fields are collapsed by default ("More details").
6. **Honest statistics.** Always show sample size (n). Below n = 10 show values greyed out; below n = 20 show an "insufficient data" badge. Never present a pattern as an edge without its sample size and confidence interval.
7. **No fake data in production.** Seed data only in a separate dev seed script.
8. **Every phase ends tested and deployed** (section 12).

---

## 3. Who I am and how I trade (domain context — use it everywhere)

- Discretionary intraday futures trader. Framework: **Axia Futures**, **Auction Market Theory / Market Profile (Dalton)**, **order flow** (footprint, CVD, DOM/price ladder, absorption, icebergs).
- My process is organised around three pillars: **Context → Edge → Process**. Grades, reviews and analytics should use these three pillars.
- Core market: **ES**. Also trade/study: NQ, RTY, YM, CL, NG, GC, SI, HG, ZT, ZF, ZN, ZB, UB, 6E, 6J, 6B, 6A, BTC, ETH (CME), and FGBL (Eurex).
- Platform: MotiveWave on a Mac mini with Rithmic data. I record screen videos of trades.
- Location/timezone: **Lisbon (Europe/Lisbon)**. I prepare before the European session and again before the US session.
- Trade selection philosophy: I want to trade **only the fastest, most directional moves** — those born from liquidation of positions and from information catalysts (scheduled and unscheduled) — and deliberately avoid chop. Power-law thinking: few high-conviction, asymmetric trades.
- Main strategy I'm developing: **pullback trader** — passive limit orders on the **first test of "beginning zones"** (origin zones of directional moves).
- Standing rule: **be flat before any major scheduled news release.**
- I study month-end flows using London fixing windows (FX 15:45–16:00, EU bonds 16:10–16:15, Brent 16:20–16:30, EU equities 16:25–16:35, Gold 18:25–18:30, WTI 19:20–19:30, Treasuries 19:55–20:00, US equities 20:50–21:00, all London time).

### The five Axia edge domains (the backbone of the whole data model)

| Domain | Code | Covers |
|---|---|---|
| Technical Analysis | `TECHNICAL` | Auction theory, fractal principles, volume analysis, chart patterns, price action, order flow |
| Scheduled Data | `DATA` | NFP, CPI, PCE, PPI, Retail Sales, ISM, JOLTS, GDP, jobless claims, EIA crude inventory, API, nat gas storage, Treasury auctions (2/5/7/10/20/30Y), etc. |
| Unscheduled News & Narrative | `NEWS` | Geopolitics, crises, tariffs, pandemics, surprise headlines, shifting narratives |
| Central Banks | `CENTRAL_BANKS` | FOMC/ECB/BoE/BoJ/SNB/RBA decisions, pressers, minutes, dot plots, speeches, Jackson Hole, unexpected comments |
| Flow | `FLOW` | OPEX, quad witching, VIX expiry, month/quarter/year-end, fixing windows, MOC, cash opens/closes, index rebalances, seasonality windows |

Every trade, playbook, calendar event and scenario has **one primary domain** and optional **secondary domains**. Multi-domain confluence is a first-class analytical dimension.

---

## 4. Tech stack (use exactly this unless you have a strong reason — log it in DECISIONS.md)

- **Next.js** (latest stable, App Router) + **TypeScript strict**.
- **Tailwind CSS** + **shadcn/ui** components. **lucide-react** icons.
- **Supabase**: Postgres, Auth (email magic link + password), Storage (private buckets), Row Level Security on every table.
- Migrations with the **Supabase CLI** (`supabase/migrations`), generated TypeScript types committed.
- Forms: **react-hook-form + zod** (shared zod schemas between client and server).
- Tables: **TanStack Table**. Charts: **Recharts**. Rich text: **Tiptap** (with image paste/drop).
- Dates: store everything in **UTC** (`timestamptz`); display in Europe/Lisbon with optional secondary clock (New York / London). Use `date-fns-tz`.
- AI: **Anthropic Claude API**, server-side only, model name from env var `ANTHROPIC_MODEL` (check Anthropic docs for the current recommended model at build time).
- Tests: **Vitest** (unit, esp. P&L/R math and stats), **Playwright** (end-to-end critical flows).
- Hosting: **Vercel** (production + preview deployments), region close to Supabase EU.
- Package manager: pnpm. Lint: ESLint + Prettier. CI: GitHub Actions running typecheck, lint, unit tests, and Playwright on every push.

No other heavy dependencies without logging why.

---

## 5. Information architecture (keep it to this)

Top navigation, 5 items + settings:

1. **Today** — the home screen. Context-aware: shows what I should be doing now.
2. **Journal** — all trades, missed trades and observations; list + detail.
3. **Review** — daily debriefs and weekly reviews.
4. **Insights** — analytics, filters, pattern finder, AI analysis.
5. **Playbook** — strategies and playbooks by domain.
6. **Settings** — instruments, tags, rules, calendar templates, import/export, account.

Global: a floating **"+ Log trade"** button on every page, and keyboard shortcuts (`N` new trade, `P` prep, `D` debrief, `/` search, `G then T/J/R/I/P` navigate). Command palette with `⌘K`.

Dark theme by default (light available). Fully responsive: I must be able to log a trade and upload photos from my phone.

---

## 6. Module specs

### 6.1 Today (home)

A state-aware page driven by Lisbon time and what's already done:

- **Before EU session:** "Start EU prep" card (or continue if draft exists).
- **Between EU and US:** EU prep summary + "Refresh for US session" card.
- **During session:** compact view of today's plan (key levels, scenarios, today's events with countdowns, rules), and a big "Log trade" button. Show a clear banner **N minutes before any high-importance scheduled event**: "High-impact event in 10 min — be flat" (my standing rule).
- **After session:** "Start debrief" card.
- Always visible: open action items from past debriefs flagged "show in prep", and today's P&L in R and $ (small, not dominant).

Session times configurable in Settings (defaults: EU prep before 08:00 Lisbon; US cash open 14:30 Lisbon, adjusting automatically for US/EU DST differences because times are defined in their native timezone).

### 6.2 Session Preparation

One prep per session per day (`EU`, `US`). The US prep can "copy forward" from the EU prep and edit only what changed. Sections (each collapsible, all optional except readiness):

1. **Readiness check** — sleep, energy, focus (1–5 each) + one line "How am I?". Quick.
2. **Paste brief** — a large text field to paste an external pre-session brief (I generate these elsewhere). Rendered as markdown.
3. **Environment / Context**
   - Prior day/session type (picklist: Trend, Double distribution, Normal, Normal variation, Neutral, Non-trend, P-shape, b-shape, custom).
   - Market regime (picklist: Trending, Balancing/rotational, Breakout pending, Event-driven, Illiquid/holiday; custom allowed).
   - Volume & volatility vs normal (Low / Normal / High).
   - Narrative (short text: what is the market focused on).
   - Options/positioning notes (short text).
4. **Today's calendar** — auto-pulled from the Calendar (section 6.7) for this date, grouped by domain, with importance and time in Lisbon + native time. One click to add an event.
5. **Key levels** — per instrument, table rows: price (or zone high/low), type (PDH, PDL, PDC, ONH, ONL, VAH, VAL, POC, naked POC, single prints, poor high/low, **beginning zone**, weekly/monthly levels, custom), **strength 1–3** (visual weight in UI so the strongest levels stand out — I get overwhelmed by too many levels, so show strength 3 first and allow hiding 1s), note. "Carry forward" button to copy untested levels from yesterday.
6. **Scenarios (If → Then)** — rows: instrument, "If…" condition, "Then…" plan, linked playbook, domain, direction. These are later marked in the debrief as *played out / didn't / partially*.
7. **Focus** — focus instruments (max 3 suggested), selected playbooks for today, one-sentence intention.
8. **Risk plan** — max daily loss ($ and R), max number of trades, max size per trade. Shown as a live gauge on Today during the session.
9. **Rules check** — my active rules (from Settings) as a checklist to acknowledge.

A "Prep complete" button locks nothing but marks status and timestamps it (used in analytics: prep done vs not, prep time).

### 6.3 Trade Log (Journal)

Three record kinds in ONE table, same form:
- **Taken** — a real trade.
- **Missed** — a setup I saw and didn't take (log hypothetical entry/exit so analytics can compute "left on the table").
- **Observed** — a notable market move I'm studying, not a trade (for my study of fast directional moves: when it started, what triggered it, its phases, how far it travelled in ticks, duration).

**Quick form (required, < 60 s):** kind, instrument, direction, entry time, entry price, exit time, exit price, contracts, primary domain. Defaults: today, last used instrument, current time.

**More details (collapsed):**
- Stop price, initial target, planned R.
- Fees (default per instrument per contract from Settings).
- MAE / MFE in ticks (optional).
- Secondary domains.
- Linked playbook (and the playbook version at time of trade, stored automatically).
- Linked calendar event and **minutes relative to the event** (auto-computed: e.g. +3 min after CPI).
- Linked scenario from today's prep, and linked key level.
- Session (Asia / EU / US — auto from time).
- Entry type (limit passive / market aggressive / stop), exit reason (target, stop, trail, discretionary, time, rule-based flatten before news).
- Pre-trade confidence 1–5.
- **Grades: Context, Edge, Process** (each A/B/C/F with a one-line optional reason). Process grade is independent of outcome.
- Tags (multi-select by group, section 6.8).
- Thesis (why), Management (what I did in the trade), Lesson.
- **Media**: paste screenshots directly with ⌘V anywhere in the form, drag & drop images/videos, or add a link (YouTube unlisted, Drive, etc.). Captions per item. Video upload uses **resumable uploads (TUS)** with progress bar; show a clear error if the file exceeds the plan limit and suggest the link option. Images get thumbnails.

**Auto-computed (never typed):** ticks, gross P&L, net P&L, R multiple (if stop given), duration, day of week, time-of-day bucket (30-min buckets in exchange time).

**List view:** filterable/sortable table (date, instrument, kind, direction, domain, playbook, R, $, grades, tags, media icon). Calendar heatmap view of daily P&L. Clicking a row opens a detail panel with media gallery (lightbox, video player) and edit.

**Partial fills / scaling:** store trade-level average entry/exit and total contracts. The CSV importer keeps raw fills in a `fills` table linked to the trade for reference.

### 6.4 Daily Debrief

One per trading day. Opens pre-filled with:
- Day stats (trades, win rate, net R, net $, best/worst trade, rule violations count).
- Plan vs reality: each scenario from today's preps with a picker *Played out / Partially / Didn't happen* and "Did I trade it?".
- Key levels with "Tested? Respected?" quick toggles (feeds level-strength analytics).
- Missed trades of the day.

I fill:
- **Pillar grades for the day: Context, Edge, Process** (A/B/C/F) + one line each.
- Rules followed? Checklist of active rules; broken ones must get a one-line note.
- What went well (max 3 bullets), What to improve (max 3 bullets) — enforce the max to keep it focused.
- **Lesson of the day** (one sentence).
- **Action items** — text, "show in next prep" toggle. Open actions appear on Today and in the next prep until marked done/dropped.
- Mood/energy end of day (1–5).
- Media (e.g. end-of-day chart screenshots).

### 6.5 Weekly Review

Generated view for any ISO week: stats summary, equity curve in R, breakdown by domain and playbook, top 3 and bottom 3 trades by R and by process grade, rule-violation trend, open actions, plus an optional **AI weekly review** (section 6.9). I add a free-text reflection and up to 3 goals for next week (shown on Today all next week).

### 6.6 Playbook (strategies within the 5 domains)

- Landing: five domain columns/sections, each listing its playbooks as cards with status and live stats (n, win rate, expectancy R, last traded).
- **Playbook template** (structured fields + a rich-text free area):
  - Name, primary domain, secondary domains, markets, status (**Idea → Testing → Active → Retired**).
  - One-line summary.
  - **Context** — when this playbook is valid (market regime, day type, event conditions, time windows).
  - **Edge** — why it works (the participant/imbalance logic).
  - **Trigger & entry**, **Stop / invalidation**, **Targets & management**.
  - **Do NOT trade when…** (filters).
  - **Pre-entry checklist** (editable list — shown as a checklist when logging a trade on this playbook).
  - Free notes (Tiptap, with pasted images).
  - **Examples** — auto-populated gallery of linked trades (best A-process examples first), plus manually pinned example media.
  - **Stats** — auto from linked trades: n, win rate, avg R, expectancy, profit factor, R distribution, by instrument, by time of day, by event proximity, and process grade distribution.
- **Versioning:** every save of structured fields creates a version snapshot; trades store the version they were taken under; a history panel shows diffs and lets me compare stats before/after a rule change.
- Seed (as `Idea`/`Testing` drafts I can edit or delete): "First test of beginning zone — passive limit pullback" (TECHNICAL), "Flat before major scheduled release" as a rule, and "Month-end fixing window flow" (FLOW) with the London windows listed in section 3.

### 6.7 Calendar (events across domains)

- Month/week/day views. Each event: date-time (stored UTC, entered in the event's native timezone), domain, category, title, importance (1–3), affected instruments, forecast / previous / actual (text), notes.
- **Quick-add presets** for common events (NFP, CPI, PCE, PPI, FOMC decision + presser, FOMC minutes, ECB, BoE, BoJ, EIA crude Wed 10:30 ET, Nat gas storage Thu 10:30 ET, API Tue, jobless claims Thu 8:30 ET, Treasury auctions, Jackson Hole, Fed speaker) that prefill domain, time, importance and instruments.
- **Recurring templates** I can toggle on (e.g. weekly EIA, weekly claims).
- **Auto-generated FLOW events** (deterministic, computed, clearly marked "generated"): monthly OPEX (3rd Friday), quarterly quad witching (Mar/Jun/Sep/Dec), VIX expiration (per Cboe rule — verify and unit-test against known dates), last business day of month / quarter / year + my London fixing windows, US cash open/close, EU cash open, MOC imbalance time (verify current NYSE time). Exchange holidays: maintain an editable holiday list (seed known dates for the current and next year and flag that it needs yearly review).
- Unscheduled NEWS events can be logged after the fact ("headline log") with timestamp, so trades can be linked to them.
- No external economic-calendar API in v1 (reliability). Design a clean import function so a feed can be plugged in later.

### 6.8 Tags (controlled vocabulary)

Tag groups with editable tags and colours. Seed with:
- **Context:** trend day, balance day, open drive, open test drive, open rejection reverse, open auction in range, open auction out of range, gap up, gap down, inside prior value, outside prior value, pre-event, post-event, liquidation, short covering, rotational.
- **Order flow / technical detail:** absorption, iceberg, stop run, initiative buying, initiative selling, delta divergence, exhaustion, failed auction, excess, poor high/low, single prints, beginning zone first test, retest, breakout, VWAP.
- **Mistakes:** early entry, late entry, chased, moved stop, no stop, oversized, revenge trade, overtrading, cut winner early, held loser, traded chop, traded into news, ignored plan, FOMO.
- **Emotion/state:** calm, confident, hesitant, fearful, frustrated, euphoric, tired, distracted.

Keep tags few; let me merge and rename (merging re-tags all history).

### 6.9 Insights (analytics & pattern finder)

**Global filter bar** (persists across Insights tabs, savable as named "Views"): date range, kind (taken/missed/observed), instrument, direction, primary/secondary domain, playbook (+ version), session, day of week, time-of-day bucket, minutes relative to event (e.g. −30…0, 0–5, 5–15, 15–60), event type, market regime, prior day type, tags (any/all/none), grades, confidence, prep done yes/no, readiness score range, level strength.

**Tabs:**

1. **Overview** — n, net R, net $, win rate, average win/loss R, expectancy (R), profit factor, max drawdown (R and $), longest win/loss streak; equity curve in R (primary) and $; R-multiple histogram; calendar heatmap.
2. **Breakdowns** — any single dimension vs metrics (bar chart + table with n and 95% CI for win rate using Wilson interval and bootstrap CI for expectancy). Heatmap: time of day × weekday (expectancy, colour-coded, n shown in cell).
3. **Pattern Finder ("pattern bridging")** — this is the core edge-discovery tool:
   - Mines combinations of 2 and 3 attributes (domain, secondary domain, playbook, tags, time bucket, weekday, event proximity, regime, prior day type, instrument, level strength, confidence, readiness) within the current filter.
   - Ranks combinations by expectancy lift vs baseline, **only where n ≥ a configurable minimum (default 8)**, and shows n, win rate + CI, expectancy + CI.
   - Two lists: **"Strongest conditions"** and **"Leaks"** (weakest).
   - **Domain confluence** view: single-domain trades vs 2-domain vs 3+ domain confluence, and each domain pair matrix (e.g. DATA + TECHNICAL).
   - **Missed & observed** analysis: expectancy of missed trades by playbook (what I'm leaving on the table), and characteristics of observed fast moves (trigger domain, time, distance in ticks, duration) to reveal where big moves come from.
   - Clearly label everything as *hypothesis to test*, never "edge confirmed".
4. **Process** — process grade vs outcome 2×2 matrix (good process/good outcome, good/bad, bad/good, bad/bad); mistake tag frequency and their cost in R; rule violations over time; readiness score vs results; prep done vs not.
5. **Plan accuracy** — scenario hit rate, key level respect rate by level type and strength, whether trades aligned with the plan performed better.
6. **AI Analysis** — see below.

Every chart: click-through to the underlying trades.

**AI Analysis (Claude API):**
- Buttons: "Analyse current filter" and "Generate weekly review".
- Server computes aggregates in SQL first; sends Claude a compact JSON (aggregates + pattern-finder output + up to ~100 most relevant trades' short text fields: thesis, lesson, tags, grades). No media sent.
- Ask for **structured JSON output**: findings[] each with {title, observation, evidence_trade_ids[], sample_size, confidence: low/med/high, suggested_experiment, related_playbook_id?}. Validate with zod; on failure retry once, then show a clean error.
- System prompt for Claude must forbid inventing numbers (only use provided numbers), require flagging small samples, and frame results as hypotheses with a concrete next experiment. Use my Context/Edge/Process and five-domain language.
- Render findings as cards with links to evidence trades and a "Create action item" / "Add note to playbook" button.
- Store every analysis in `ai_insights` with its filter and timestamp. Cache: don't re-call for identical filter + data hash.
- API key only in server env. Show token/cost estimate per run in a small footnote.

### 6.10 Settings

- **Instruments** (editable table): symbol, name, exchange, asset class, tick size, tick value, currency, default fees per contract (round turn), active, sort order. Seed from the table below — **verify every value against current CME/Eurex contract specs before seeding and write a unit test per instrument for P&L math.**

| Symbol | Tick size | Tick value |
|---|---|---|
| ES | 0.25 | $12.50 |
| MES | 0.25 | $1.25 |
| NQ | 0.25 | $5.00 |
| MNQ | 0.25 | $0.50 |
| RTY | 0.10 | $5.00 |
| YM | 1 | $5.00 |
| CL | 0.01 | $10.00 |
| NG | 0.001 | $10.00 |
| GC | 0.10 | $10.00 |
| SI | 0.005 | $25.00 |
| HG | 0.0005 | $12.50 |
| ZT | 1/8 of 1/32 | $7.8125 |
| ZF | 1/4 of 1/32 | $7.8125 |
| ZN | 1/2 of 1/32 | $15.625 |
| ZB | 1/32 | $31.25 |
| UB | 1/32 | $31.25 |
| 6E | 0.00005 | $6.25 |
| 6J | 0.0000005 | $6.25 |
| 6B | 0.0001 | $6.25 |
| 6A | 0.00005 | $5.00 |
| BTC | 5 | $25.00 |
| ETH | 0.50 | $25.00 |
| FGBL | 0.01 | €10.00 |

  Treasury futures prices must support entry in both decimal and 32nds notation (e.g. `110'16.5`), with a parser that is unit-tested.
- **Rules** (my non-negotiables): text, category, active. Seed: "Be flat before any major scheduled news release."
- **Session times**, **display timezone(s)**, **currency display**, **R definition** (R = initial risk from stop; if no stop, R not computed and flagged).
- **Tags**, **calendar presets & recurring templates**, **holidays**.
- **Import** (section 7) and **Export**: one-click full export (JSON of all tables + CSV per table + a zip of media links). Also a scheduled weekly export to a Supabase Storage "backups" bucket via a Vercel Cron route.

---

## 7. CSV importer

- Upload CSV → preview first 20 rows → column mapping UI (save mapping as a named preset, e.g. "Rithmic R|Trader Pro", "MotiveWave").
- Group fills into round-trip trades (flat-to-flat per instrument/account), compute average prices, create `fills` rows linked to each trade.
- **Idempotent:** hash each fill (account, symbol, time, price, qty, side) and skip duplicates on re-import. Show an import summary (created, skipped, errors) before committing; commit inside a transaction.
- Imported trades land with kind = Taken and a "Needs review" badge until I add domain/grades — Today shows "3 imported trades need tagging".

---

## 8. Data model (Postgres; adapt names if needed, keep the concepts)

All tables: `id uuid pk default gen_random_uuid()`, `user_id uuid references auth.users not null default auth.uid()`, `created_at`, `updated_at` (trigger), `deleted_at` (soft delete). RLS: `user_id = auth.uid()` for all operations.

- `instruments` — see 6.10.
- `trading_days` — `date` (unique per user), `status` (open/closed).
- `session_preps` — `day_id`, `session` (EU/US), readiness fields, `brief_md`, prior_day_type, regime, vol_state, narrative, options_notes, focus_instruments[], intention, max_loss_usd, max_loss_r, max_trades, max_size, `completed_at`.
- `key_levels` — `prep_id`, `instrument_id`, `price_low`, `price_high`, `level_type`, `strength` (1–3), note, `tested` bool, `respected` bool (debrief).
- `scenarios` — `prep_id`, `instrument_id`, direction, if_text, then_text, `playbook_id`, primary_domain, `outcome` (played/partial/didnt/null), `traded` bool.
- `calendar_events` — `starts_at`, `native_tz`, primary_domain, category, title, importance, instruments[], forecast, previous, actual, notes, `source` (manual/preset/generated/headline), `generator_key` (for idempotent generation).
- `trades` — `day_id`, `kind`, `instrument_id`, direction, entry_at, exit_at, entry_price, exit_price, stop_price, target_price, contracts, fees, and **generated/computed** columns or a trigger for ticks, gross_pnl, net_pnl, r_multiple, duration_sec, weekday, time_bucket; mae_ticks, mfe_ticks, primary_domain, secondary_domains[], playbook_id, playbook_version, calendar_event_id, minutes_from_event, scenario_id, key_level_id, session, entry_type, exit_reason, confidence, grade_context, grade_edge, grade_process (+ reason fields), thesis, management, lesson, `needs_review` bool, `import_hash`.
- `fills` — `trade_id`, time, side, price, qty, raw jsonb, `hash` unique.
- `tag_groups`, `tags`, `trade_tags`.
- `media` — `owner_type` (trade/prep/debrief/playbook/event), `owner_id`, `kind` (image/video/link), `storage_path` or `url`, caption, width, height, duration, size_bytes, sort.
- `debriefs` — `day_id` unique, grade_context/edge/process + notes, went_well[], to_improve[], lesson, mood, energy.
- `rules`, `rule_checks` (per day/prep: rule_id, followed bool, note).
- `action_items` — source (debrief/weekly/ai), text, status, show_in_prep, due_date.
- `weekly_reviews` — iso_year, iso_week, reflection, goals[].
- `playbooks` — fields from 6.6 + `version` int; `playbook_versions` (snapshot jsonb); `playbook_checklist_items`.
- `saved_views` — name, filter jsonb.
- `ai_insights` — scope, filter jsonb, data_hash, model, output jsonb, tokens, cost_estimate.
- `import_presets` — name, mapping jsonb.

Put analytics-heavy logic in **SQL views / RPC functions** (e.g. `trade_facts` view flattening a trade with its tags, event, prep context) so the frontend stays simple and fast. Add indexes on `(user_id, entry_at)`, `primary_domain`, `playbook_id`, `instrument_id`.

**Storage:** private bucket `media` with path `user_id/owner_type/owner_id/filename`; access only via signed URLs; storage RLS policies scoped to `user_id`.

---

## 9. UX & design rules

- Visual tone: calm, dense but readable, professional trading-desk feel. Dark default, one accent colour, green/red only for P&L. Each of the five domains has a fixed, subtle colour used consistently (badges, charts, calendar).
- Numbers in tabular monospace. R shown before $ everywhere.
- Empty states explain the one next action ("No trades yet — press N to log your first one").
- Every destructive action has undo (toast with "Undo").
- Loading states use skeletons; no layout jumps.
- Mobile: bottom nav, trade quick form usable one-handed, camera/photo upload works.
- Accessibility: keyboard navigable, labels on inputs, sufficient contrast.
- Performance: pages interactive < 1.5 s on broadband; Insights queries < 1 s for 5,000 trades (test with a generated dataset in dev only).

---

## 10. Security & privacy

- Single user. Disable public sign-ups after my account is created (or restrict to my email).
- RLS on every table and storage bucket; write a test that an unauthenticated client and a second test user cannot read my data.
- Secrets only in environment variables (Vercel + `.env.local`, never committed). Provide `.env.example`.
- Security headers (CSP, etc.) via Next.js config.

---

## 11. Quality bar

- TypeScript strict, no `any` without comment.
- **Unit tests (Vitest):** tick/P&L/R math for every instrument, 32nds parser, time bucket and session assignment across DST changes (Lisbon, London, New York), flow-calendar generator (OPEX, quad witching, VIX expiry, month-end) against known dates, stats functions (Wilson CI, bootstrap, expectancy, profit factor, drawdown), CSV fill grouping.
- **E2E tests (Playwright):** login; create EU prep → log trade with pasted image → debrief → see it in Insights; import CSV twice (no duplicates); playbook edit creates a version; autosave survives page reload; soft delete + restore.
- Error monitoring: log server errors to a simple `error_logs` table (or Sentry if trivial) and show nothing scary to the user — just "Something failed, retry".

---

## 12. Build phases (do them in order; at the end of each: typecheck, lint, tests green, commit, deploy to Vercel preview, then STOP and give me a short report with the preview URL and what to test)

**Phase 0 — Setup**
Answer section 0 questions. Create repo structure, `CLAUDE.md` (project conventions, commands, architecture summary for future sessions), `DECISIONS.md`, `.env.example`, CI workflow, Supabase project link, Vercel project link. Auth working, empty app shell with navigation deployed.

**Phase 1 — Data foundation**
All migrations, RLS, storage bucket + policies, seeds (instruments, tags, rules, playbook drafts, presets), generated types, `trade_facts` view, unit tests for math and time utils.

**Phase 2 — Trade logging**
Quick form + details, autosave, media (paste, drag-drop, TUS video, links), Journal list + detail, soft delete/restore, keyboard shortcuts, mobile layout.

**Phase 3 — Calendar & Session Prep**
Calendar with presets, recurring templates and FLOW generator; Prep (EU/US, copy forward, levels, scenarios, risk plan, rules); Today page state machine and pre-event "be flat" banner.

**Phase 4 — Debrief & Weekly Review**
Debrief prefilled from the day; action items flowing into Today/Prep; weekly review page.

**Phase 5 — Playbook**
Domain landing, template, checklist on trade entry, versioning with diffs, live stats, examples gallery.

**Phase 6 — Insights**
Filter bar + saved views, Overview, Breakdowns, Pattern Finder, Process, Plan accuracy. All with n and CIs and click-through.

**Phase 7 — AI Analysis**
Claude integration with structured output, caching, storage of insights, action-item creation.

**Phase 8 — Import/Export & backups**
CSV importer with presets and idempotency; full export; weekly backup cron.

**Phase 9 — Hardening & production launch**
Full E2E suite, performance test with generated data (dev only), accessibility pass, remove any unfinished feature from the UI, production deploy on Vercel, custom domain if I provide one, and a short `USER_GUIDE.md` (one page: daily workflow in 5 steps).

---

## 13. Explicitly OUT of scope for v1 (do not build)

- Live broker connection / automatic real-time trade sync.
- Charting or market data display inside the app.
- Multi-user, teams, sharing, social features.
- External economic calendar or news API integrations (design for later only).
- Gamification, streak confetti, notifications beyond the in-app event banner.
- Native mobile apps.

---

## 14. Definition of done

- I can, on my phone and on my Mac, do the full daily loop — prep → log trades with screenshots/videos → debrief — without friction or any lost data.
- Insights show honest, filterable statistics with sample sizes and let me find the strongest and weakest condition combinations across the five domains.
- Playbooks live inside the five domains with versions and auto-computed stats from real trades.
- All tests pass in CI, production is deployed on Vercel, backups run weekly, and `USER_GUIDE.md` exists.
- No visible feature behaves inconsistently.

---

## 15. How to work with me

- Use plan mode for each phase: show me the plan in ≤ 15 bullets before coding the phase.
- Commit small and often with clear messages. Keep `CLAUDE.md` and `DECISIONS.md` updated.
- If something in this spec conflicts with reliability or simplicity, choose reliability and simplicity and tell me.
- When you finish a phase, give me: preview URL, what's done, what to test (max 5 checks), known limitations, and what's next.
