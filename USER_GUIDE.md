# Consistent Grow — user guide

Your trading journal and edge lab. Times are shown in Lisbon; sessions follow their own time
zones (London for EU, New York for US), so daylight-saving changes need no attention.

## The daily routine (Today)

**Today** is one timeline of your routine, in Lisbon time. The running block is open; the rest
are folded. Edit blocks, times, setups and limits in **Settings → Daily routine**.

| Lisbon (usually) | Block                 | What you do there                                                                                                                                    |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07:15–08:00      | **EU prep**           | Tick: Morning Bid Europe (link), Claude Pre-Open (shown inline), 1h charts. Then the **60-second prep** (below).                                     |
| 08:00–13:00      | **EU news trades**    | Only the day's high-impact events qualify. None? **No event, no EU trade** — confirm it with one tap.                                                |
| 13:00–14:25      | **US prep**           | Morning Bid US, US Pre-Open, 1h charts, 60-second prep.                                                                                              |
| 14:30–15:30      | **US open (1h plan)** | Tick "open plan written", then trade the plan.                                                                                                       |
| 17:00–20:00      | **Midday scalp**      | First the **3-tap check**: winning side so far (VWAP / day's open), trend day (1st-hour range broken and held), 1h agrees. It sets the block's bias. |
| 20:50–21:00      | **MOC breakout**      | Read the 15:50 ET imbalance, trade the 5-min breakout.                                                                                               |
| 21:05            | **2-minute debrief**  | One tap per block: plan followed yes / partly / no, one line, a grade for the day.                                                                   |

- Times are stored in each market's own zone (London / New York), so in the weeks when only one
  side has changed its clocks (late March, late October) the US blocks move by an hour in Lisbon
  on their own — the MOC is then at 19:50.
- **60-second prep:** a one-line narrative (prefilled from the Pre-Open's TL;DR), the instruments
  in that narrative and a long / short / neutral bias for each. The full prep (levels, scenarios,
  risk, rules) is one link away and still feeds Insights.
- **Log from the block:** the block's button opens the trade form with the setup, the first
  narrative instrument and the bias already filled in.
- **Guardrails:** each trade block counts its trades and P/L (by setup, or by time when a trade has
  no setup). At its trade or loss limit — or the daily loss limit — the block says **done for this
  block**. You can still log a trade that happened.
- **Alerts:** Settings → Daily routine → turn on alerts on this device for a notice a few minutes
  before each block (only while the app is open in a tab).
- On a weekend or holiday, Today shows the next trading day's routine so you can prepare ahead.

**Setups** are four playbooks seeded as drafts: EU news event, US open — 1h plan, Midday scalp —
1-min supply/demand, MOC — 5-min breakout. Edit their checklists in **Setups**. The weekly review
has a **setup scorecard**: this week vs all time (n, win rate and average R with 95% ranges), how
often you followed the plan, and a keep / tweak / drop note. Judge on the all-time record; below
20 trades, keep collecting.

## Other regular steps

| When           | Where                  | What                                                                                            |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| ~06:40 / 12:40 | automatic              | The AI routine prepares pre-session notes (they appear on **Today**).                           |
| ~06:58 / 12:58 | automatic              | The Macro Desk brief arrives: shown in the prep block and in the full prep.                     |
| Next morning   | **More → Statements**  | Upload the Axia PDF; split each product's day into trades (one tap gives each trade its setup). |
| Saturday       | **Review → This week** | Setup scorecard, reflection, goals, the week's numbers and the weekly AI analysis.              |
| Whenever       | **More → Insights**    | Where the edge is, where the leaks are.                                                         |

The full debrief (three grades, scenarios and levels, rules, action items) is optional: **Debrief →
Full debrief**. Both views save the same grade and lesson.

## Logging trades

- **Kinds:** _taken_ (real), _missed_ (a valid setup you didn't take) and _observed_ (a move you
  studied). Missed/observed never mix into real results unless you include them explicitly.
- **R before $:** set a stop to get R. Fees come from Settings → Instruments.
- **Screenshots:** paste (Ctrl/⌘ V), drop or pick; videos up to 50 MB (longer ones: paste a link).
- **Autosave:** the status shows Saved / Saving… / Error — retry. Unsaved drafts stay on the device.
- **Delete:** goes to the Journal trash for 30 days, with Undo.

## Broker statements

1. **Statements → Upload statements**: drop one or many PDFs. Each is checked (products add up,
   the summary matches, cash rolls, NLV matches) before you press **Save**.
2. The same file twice is ignored. A _different_ file for a stored day shows what changed and asks
   before replacing (the old one goes to the trash).
3. **Journal vs broker** compares, for every day and product, the broker's realized P/L with the
   gross P/L of your journal trades (±$1): _matched_, _differs_, _missing in journal_ (log it or
   import fills), _unmapped code_ (map it in Settings → Statements).
4. **Settings → Statements** links Axia product codes to instruments. "Size verified" means the
   statement's own amounts prove the contract size.
5. If a statement ever fails to read, Axia probably changed the layout: keep the PDF and ask for the
   parser to be updated. Nothing is guessed.

### Splitting a statement into trades

The PDF lists each product's fills (buys first, then sells, sorted by price) **without times**, so
it cannot say which buy was closed by which sell. **Trades** on a statement's page (or _Split into
trades_ after uploading) rebuilds your trades:

- **Suggested (N)** — the most flat trades the fills allow, grouping fills that sit close in price.
  Use − / + to merge into fewer trades. **One trade** keeps the whole product as one block.
- **Your journal (N)** appears when trades you already logged (or imported with platform fills)
  match the broker fills exactly: they are linked, not logged again, and marked _Broker-confirmed_.
- Tap a fill to move it (or part of it) to another trade, a new trade, or out. Every trade must be
  flat and the sum always equals the broker's realized P/L (the check turns green).
- Choose **Long/Short** per trade (the statement can't tell); entry/exit times are optional. Without
  times the trade shows `--:--` and stays out of time-of-day stats until you set the real times in
  the journal.
- **Add to the journal** creates the trades (taken, marked _Review_, average prices kept exact,
  statement fees shared per contract). **Undo build** moves them to the trash (30 days). Work in
  progress is kept on this device if you leave the page.

Automatic delivery: create a token with scope **Statements** in Settings → Integrations and have a
script or mail rule `POST` the PDF to `/api/ingest/statement` (see Settings → Statements).

## Reading the numbers honestly

- Every statistic shows **n**. Below 10 it is greyed out; below 20 it carries "insufficient data".
- Win rates come with a Wilson 95% interval, expectancy with a bootstrap interval. An interval that
  spans zero (expectancy) or 50% (win rate) is unproven.
- The pattern finder tests many combinations: its results are **hypotheses to test**, not edges.

## Keyboard shortcuts

| Keys                     | Action                                                    |
| ------------------------ | --------------------------------------------------------- |
| `⌘K`                     | Command palette                                           |
| `/`                      | Search the journal                                        |
| `N`                      | Log trade                                                 |
| `P`                      | Prep for the current session                              |
| `D`                      | Debrief today                                             |
| `G` then `T` `J` `R` `P` | Today, Journal, Review, Setups                            |
| `G` then `I` `A` `C` `S` | Insights, Statements, Calendar, Settings (under **More**) |

## Settings worth knowing

- **Daily routine** — blocks, times (in the market's zone), setup per block, gates, trade and loss
  limits, daily loss limit, alerts.
- **Instruments & fees** — commission per contract, active markets.
- **Tags** — rename, reorder, merge duplicates (with Undo), archive (hidden from pickers but kept
  in Insights) or delete (removed from stats; 30-day trash).
- **Rules** — the rules asked in every prep and debrief; turn one off to stop asking it.
- **Calendar & sessions** — session times, be-flat banner, recurring releases, holidays.
- **Integrations** — tokens for the Macro Desk brief, AI analysis and statements.
- **Data & backups** — CSV import of fills, full export (zip), weekly backups, **restore from a
  backup** (puts back missing rows only; safe to run twice).

## Your data

- Everything is private to your account (row-level security on every table and file).
- Deleted items stay 30 days in the trash, then the weekly job removes them for good — after
  storing a fresh backup. Keep an occasional export (Settings → Data) somewhere of your own.
- The AI analysis runs on your Claude subscription through a Claude Code routine; the app never
  calls an AI API and never sends your screenshots.
