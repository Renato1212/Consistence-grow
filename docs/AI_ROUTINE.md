# AI analysis routine (Claude subscription)

Consistent Grow never calls the Claude API. Analyses run inside a scheduled **Claude Code routine**
(billed to the owner's Claude plan), which reads a queue from the app and posts findings back.

## Setup (once)

1. App → Settings → Integrations → token purpose **AI analysis** → Create token. Copy it.
2. Claude Code environment settings → environment variables (secrets):
   - `CG_APP_URL` = production URL, no trailing slash (shared with the Macro Desk routine)
   - `CG_AI_TOKEN` = the token from step 1
3. Network access must allow the app's domain (same as for the brief delivery).

## Schedule (Europe/Lisbon)

| Routine         | Cron (CRON_TZ=Europe/Lisbon) | Slot     |
| --------------- | ---------------------------- | -------- |
| Pre-EU analysis | `40 6 * * 1-5`               | `eu`     |
| Pre-US analysis | `40 12 * * 1-5`              | `us`     |
| Weekly review   | `10 9 * * 6`                 | `weekly` |

Each run also processes analyses queued from the app ("Analyse current filter", "Ask Claude for this
week's review"). A slot is skipped on weekends/holidays or when the same data was already analysed,
so a quiet run exits after one request. "Run now" on a routine in the Claude app processes the queue
immediately.

## Endpoints

- `GET /api/ai/queue[?slot=eu|us|weekly]` → `{ items: [{ request_id, data_hash, label, payload }], notes }`.
  Each payload carries `instructions` (the analysis rules) and `output_schema`. Weekly payloads also
  carry `weekly.broker_statements` when broker statements were uploaded for that week.
- `POST /api/ai/findings` `{ request_id, data_hash, model, output }` → 200, or 422 with `errors` to
  fix and re-post.

Both require `Authorization: Bearer $CG_AI_TOKEN` (scope `ai`; a briefs token is refused).

## Routine prompt (SLOT = eu | us | weekly)

```text
You are the Consistent Grow analysis routine (slot: SLOT). Work only through the HTTP API below;
do not modify any repository, open PRs or create files outside /tmp. Never print, echo or log
$CG_AI_TOKEN or any environment variable value.

1. If CG_APP_URL or CG_AI_TOKEN is empty, stop and say which one is missing.
2. Fetch the queue:
   curl -sS -f -H "Authorization: Bearer $CG_AI_TOKEN" "$CG_APP_URL/api/ai/queue?slot=SLOT" -o /tmp/queue.json
   If it fails, retry once after 30 s; if it still fails, stop and report the HTTP status only.
3. If items is empty, print the notes and stop.
4. For each item: read item.payload.instructions and follow them exactly. Analyse only the data in
   item.payload. Write the result as JSON matching item.payload.output_schema to /tmp/out-N.json,
   then POST it:
   jq -n --arg id "$REQUEST_ID" --arg hash "$DATA_HASH" --arg model "<your model id>" \
     --slurpfile out /tmp/out-N.json '{request_id:$id, data_hash:$hash, model:$model, output:$out[0]}' \
     | curl -sS -H "Authorization: Bearer $CG_AI_TOKEN" -H "Content-Type: application/json" \
         --data-binary @- "$CG_APP_URL/api/ai/findings"
   On 422, read "errors", fix the output and post once more. On 5xx, retry once after 30 s.
5. Fetch the queue once more without ?slot and process any remaining items the same way.
6. Finish with one line: items analysed, items failed, notes.
```
