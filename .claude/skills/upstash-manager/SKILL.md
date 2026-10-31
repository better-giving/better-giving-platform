---
name: upstash-manager
description: Use when the user asks to inspect or fix QStash — "queue is stuck", "check the DLQ", "why didn't the cron fire", "replay that message", schedules/crons, queue lag, delivery events
user_invocable: true
---

# Upstash QStash Manager

**Jurisdiction: `apps/platform/`.** Creds come from `apps/platform/.env` (or that project's Vercel env); the routes below are `apps/platform/src/routes/`.

## Auth

Two separate mechanisms.

**Management API** (`api.upstash.com`) — `UPSTASH_EMAIL` / `UPSTASH_API_KEY`:

```sh
UPSTASH_AUTH="$(grep -m1 '^UPSTASH_EMAIL=' .env | cut -d= -f2-):$(grep -m1 '^UPSTASH_API_KEY=' .env | cut -d= -f2-)"
curl -s -H "Authorization: Basic $(printf %s "$UPSTASH_AUTH" | base64)" \
  "https://api.upstash.com/v2/..."
```

**QStash API** (`qstash.upstash.io/v2`) — `.env` holds two tokens and they are not interchangeable: `QSTASH_TOKEN` is the **local dev-server placeholder** (what the app reads), `UPSTASH_QSTASH_TOKEN` is the **cloud** token. Load the cloud one under the name the commands below use, or every call 401s:

```sh
QSTASH_TOKEN="$(grep -m1 '^UPSTASH_QSTASH_TOKEN=' .env | cut -d= -f2-)"
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" "https://qstash.upstash.io/v2/..."
```

## Conventions

- schedule IDs: `better-giving-{stage}-{name}`
- queue names: `${APP_SLUG}-${STAGE}-q` (notices), `-money-q` (splits, Connect transfers, subscription cancels, PayPal captures) and `-don-dist-q`, computed at `.server/kit/queue.ts:22-42`. Which kind rides which queue is `lane_of` in `lib/queue/registry.ts`. A stuck money job is on `-money-q`, not `-q` — check both. Local `.env` is `STAGE=staging`, so a laptop run touches the **staging** set — never assume `production-`.
- production destination `https://better.giving`, preview `https://test.better.giving`

## Destination URLs — mapping an event back to code

The one thing the API can't tell you.

- `/api/q-handler/{kind}` — every queued and scheduled message. `{kind}` is a key of `Payloads` in `lib/queue/registry.ts`; that file holds the payload shape, the dedupe key, and the per-kind retry/delay config.
- `/api/q-don-dist/{npo_id}` — donation distribution fan-out (`don_dist`, `.server/kit/queue.ts:85`).
- `/api/cron/{name}` — scheduled crons.
- `/api/cron/grants-execute` shows up in events with **no matching schedule**: the `grants` cron publishes it with a 24h delay (`src/routes/api.cron.grants/route.ts:10-14`).

## The API calls this skill actually uses

```sh
# schedules — source of truth for cron expressions and destinations
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" "https://qstash.upstash.io/v2/schedules"

# queues — name, parallelism, lag, paused
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" "https://qstash.upstash.io/v2/queues"

# failures — state is one of CREATED, ACTIVE, DELIVERED, ERROR, RETRY, FAILED
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" "https://qstash.upstash.io/v2/events?state=ERROR"

# dead letters
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" "https://qstash.upstash.io/v2/dlq"
```

Event bodies are base64: `echo "$BODY" | base64 -d | python3 -m json.tool`.

Everything else — create/pause/resume/delete a schedule or queue, publish, enqueue, DLQ delete — is plain Upstash REST at the same base URL with the same bearer header; read <https://upstash.com/docs/qstash/api> rather than a copy here.

## Debugging workflow

1. **load the cloud token** (see Auth — not `QSTASH_TOKEN` from `.env`)
2. **check queues** — non-zero `lag` means messages are stuck
3. **check events** — `state=ERROR` / `state=FAILED`
4. **decode the body**, and map the `url` back to code via the section above
5. **check DLQ** — messages that exhausted retries land here
6. **replay only after checking the kind.** Every kind is at-most-once unless it appears in the `delivery` map in `lib/queue/registry.ts`, because a retry means a duplicate send; the dedupe window is ~10 min, so it will not stop a replay of anything old enough to be in the DLQ. Read the handler first and confirm it re-reads its db row and gates its own send. **Never replay `don-dist` — it moves money** (`retries: 0` is deliberate).
7. **check schedules** — crons active, pointing at the right destination

## Rules

1. **List before you mutate.** Names and IDs are stage-prefixed and easy to hit in the wrong stage.
2. **Destructive calls against production wait for explicit user approval** — delete/pause a schedule or queue, and above all `DELETE /v2/dlq`, which purges every dead letter in the account across **both** stages.
3. **Any replay is a destructive call** — see step 6.
