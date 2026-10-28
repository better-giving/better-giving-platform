---
name: verify-platform
description: Drive apps/platform (the Better Giving web app) in a real headless browser the way a user does — home, sign-in, marketplace, the donate form through to the Stripe payment step — and return proof (pass/fail/blocked per flow, screenshots, ARIA snapshots, logs). Use after any change to platform UI, routes, loaders, db queries or the donation flow, before reporting a build done. This is NOT the lint/typecheck `verify` skill; run that too.
---

# verify-platform

Boots `apps/platform` locally against a throwaway Postgres with **only
committed filler secrets** (`apps/platform/.env.test`), drives it with
Playwright/Chromium, and writes evidence. Nothing here talks to Neon, Vercel,
or production; `neon-local.mjs` refuses a non-localhost `DATABASE_URL`.

## TL;DR

```bash
export PATH=~/.local/node24/bin:$PATH
VERIFY_OUT=/tmp/verify-$(date +%s) .claude/skills/verify-platform/scripts/run.sh            # all flows
VERIFY_OUT=... .claude/skills/verify-platform/scripts/run.sh home donate-card               # some flows
node .claude/skills/verify-platform/scripts/drive.mjs --list                                # flow list
node .claude/skills/verify-platform/scripts/drive.mjs --check-map                           # features/ ↔ README ↔ FLOWS
```

Exit: `0` all pass · `1` a flow failed · `2` only blocked flows (need secrets) · `3` launch/doctor failed.
Report `results.json` + screenshot paths verbatim. `blocked` is **not** `pass`.

## Launch

`scripts/launch.sh` (run.sh calls it). It:
1. `pg-up.sh` — initdb/start Postgres at `127.0.0.1:5433`, db `app`, data `/tmp/bg-verify-pg` (needs `apt install postgresql`; `sudo` works on the box). No trust auth and no unix socket: TCP on 127.0.0.1 only, scram-sha-256 with a random per-cluster password (`$VERIFY_STATE/pg.pass`, 0600). It writes a `.verify-platform-owned` marker into the data dir and refuses to reuse an existing dir without one.
2. writes `apps/platform/.env.verify` (gitignored, 0600): `.env.test` + local `DATABASE_URL` (with that password) + `BASE_URL=http://127.0.0.1:4200` + `CONNECTOR_RETURN_URL=http://127.0.0.1:$VERIFY_PORT/marketplace` (default port 4200). Started with `--mode verify`, and mode files beat `.env`, so a developer's real `.env` never applies. It does not set `VERCEL_ENV`.
3. builds `packages/*` (platform imports their `dist/`).
4. migrates with the repo's own `.server/pg/migrate.ts`, seeds `scripts/seed.sql` (npo `Verify Test Nonprofit` with no slug yet, plus `Verify Campaign Nonprofit` at `verify-campaign` for the campaign drives, USD rates), then `scripts/seed-member.mjs` (credential member of `Verify Test Nonprofit`, a platform admin `verify-admin@example.com` / `Verify-admin-1` for `/platform/*`, plus `Verify Other Nonprofit` with no membership).
5. `react-router dev --mode verify --host 127.0.0.1 --port 4200` with `NODE_OPTIONS="--import neon-local.mjs --import stripe-stub.mjs --import nonprofits-stub.mjs"`.
Ready = `GET /` → 200 (first SSR compile takes ~10–60 s). State in `/tmp/bg-verify` (`dev.pid`, `port`, `npo_id`, `pg.pass`, `dev.log`, `stripe-stub.log`). The state dir must be private: launch.sh/pg-up.sh create it `0700`, and refuse an existing one that is a symlink, not owned by you, or not `0700` (another local user could pre-plant the fixed `/tmp` path); `pg.pass` is never written through a symlink (`scripts/lib.sh`). On a refusal, remove the dir or set `VERIFY_STATE` to a fresh path.

Preloads (verification scaffolding — **no product code is changed**):
- `neon-local.mjs`: points the `@neondatabase/serverless` driver at local Postgres — HTTP queries via `fetchFunction` run through `pg`; transactions go over a ws→tcp pipe on `:5488`, which only dials `DATABASE_URL`'s own port and refuses any request carrying an `Origin` header (i.e. any browser).
- `stripe-stub.mjs`: while `STRIPE_SECRET_KEY` is filler, server-side `api.stripe.com` calls hit an in-process stub: `GET /v1/country_specs/:cc` is answered, everything else gets a Stripe-shaped 400 and is logged. With real test keys it is inert.
- `nonprofits-stub.mjs`: while `NONPROFITS_API_KEY` is the `.env.test` filler, `fetch` to `nonprofits.better.giving` is answered in-process (one eligible off-marketplace EIN, one revoked org, one search) and logged. Any other key leaves `fetch` alone.
- `blob-stub.mjs`: while `BLOB_READ_WRITE_TOKEN` is filler, `@vercel/blob` `put()` is answered by a local server (the sdk honors `VERCEL_BLOB_API_URL`) and the stored URL is the app's `/logo.png`. A real token leaves the sdk pointed at Vercel. Logged to `blob-stub.log`.

Full card flow: `VERIFY_STRIPE_SK=sk_test_… VERIFY_STRIPE_PK=pk_test_… scripts/run.sh donate-card` (live keys are refused). Never paste keys into files.

Env knobs: `VERIFY_PORT` (4200), `VERIFY_PG_PORT` (5433), `VERIFY_WS_PORT` (5488), `VERIFY_STATE`, `VERIFY_OUT`, `KEEP_DB=1` (cleanup leaves Postgres up for a faster relaunch).

## Doctor

`scripts/doctor.sh` — read-only; exit 0 = worth driving. Checks: dev server pid from launch.sh alive, `GET /` 200, local Postgres reachable with migrations applied, `.env.verify` points at the local db, and `drive.mjs --check-map` (every `features/*.md` except `README.md`, every README link to one of those files, and every `FLOWS` key are the same set). Run it first whenever anything looks off. A map mismatch fails the doctor even when the server is healthy, and `drive.mjs` refuses to start on the same mismatch.

## Isolation

One instance per box at a time on the default ports (4200 is the app's `strictPort`). launch.sh refuses if :4200 is held by something it didn't start; set `VERIFY_PORT`, `VERIFY_PG_PORT`, `VERIFY_WS_PORT`, `VERIFY_STATE`, `VERIFY_PG_DIR` to run a second one. Don't drive an instance someone else started.

## Drive

`scripts/drive.mjs [flow…]` — one fresh browser context per flow, 1280×900 (wide enough that the desktop header, shown from 75rem, is on screen). Flows (details in `features/`):

A listed entry point the drive did not take is not verified. `results.json` records `entry.clicked` and `entry.loaded` for each flow. A pass verifies those and nothing else: a header or footer control counts only when this run clicked it, and a direct load counts only for the URL it requested. Reaching the same screen by the other path does not verify the one that was skipped. Report `entry` from `results.json`; do not promote a path that is absent from it.

| flow | proves |
|---|---|
| `home` | direct `GET /` 200, title is "Fundraising Platform for Nonprofits - Better Giving", header `Log In` href is `/login`. This flow does not click `Log In`. |
| `login` | from `/`, click header `Log In` → Google + email/password; wrong password → "Invalid email or password", stays on /login (better-auth + db). Then direct `GET /login` → 200. |
| `marketplace` | from `/`, click footer `Marketplace` → seeded npo card (db read path). Then direct `GET /marketplace` → 200 and the same card. |
| `donate-card` | direct `GET /donate/:id` → +100 USD → Continue with Card → donor info → payment step with summary $100.00; with real test keys, types 4242… into the Stripe Payment Element (`donate-card-4-card.png`). The marketplace-card Donate link is not clicked, so it is not verified. |
| `smoke-paths` | smoke.yml's direct `GET /`, `GET /api/currencies`, `GET /form-embed.js` each < 400. No screenshot. |
| `connector-allow` | direct `GET /login` (the header `Log In` link is not clicked), sign in as the seeded member, direct `GET /admin/connector/allow?state=verify-state-1`, only `Verify Test Nonprofit` is listed, click Allow, land on `/marketplace` with `iss`, `state=verify-state-1`, and a non-empty `code`. |
| `agents-find` | direct `POST /agents/mcp` `find_nonprofit` for the seeded nonprofit, plus a flagged off-marketplace EIN from the nonprofits stub, and `quote_donation` refuses that EIN. The seeded nonprofit lists `increments: []`. No screenshot. |
| `agents-quote` | direct `POST /agents/mcp` `find_nonprofit` for `Verify Campaign Nonprofit` lists its seeded increments sorted with the bad value dropped; `quote_donation` at 25 carries that increment's label and at 30 carries `null`. No screenshot. |
| `org-slug` | sign in as the seeded npo admin, click sidebar `Organization`, set `verify-test`, reload to the disabled field and the set-once note, then `GET /donate/verify-test` and `GET /marketplace/verify-test`. |
| `campaign-admin` | sign in as the seeded npo admin, click sidebar Campaigns, open the pinned profile card, publish a new campaign, see it live at $0 next to the existing listing, decode the campaign QR. Screenshots of the donor dashboard, the list, and `/fundraisers/<id>` contain no "fundraiser". |
| `campaign-page` | direct `GET /org/<org>/<campaign>` 200 with hero, story, video, goal, supporter wall, and badge; no Log In, About this campaign, Spread the word!, and no Videos heading. Click Donate, then Continue with Card. Click Share, then Share on LinkedIn. Head title, description, and hero. `GET /org/<org>` 302 to `/marketplace/<org>`. Draft and unknown slugs 404. |
| `campaign-donate` | on the campaign page, `?amount=50&frequency=monthly` opens the donate dialog with those values; a plain load clicks Donate, then +100 USD → card → donor info → summary $100.00; the intent POST carries `campaign_id`. With filler keys the card step is blocked; with test keys, types 4242…. |

`scripts/contract.mjs` checks keyless hello (including the served action list), keyless 401s on the MVP paths, and `unknown_action` on phase-2 paths against an origin you pass. `CONNECTOR_KEY` optionally checks the list reads. It does not run the browser Allow flow.

On a cold dev server, scrolling the footer into view prefetches `/donate/1`. Vite reloads and cancels the click. `open_link` retries that same click (header `Log In` and footer `Marketplace`). It does not switch to `goto`. That prefetch can also leave the next direct `/donate/:id` load with a 504 on optimized dependencies, so the amount buttons stay disabled. The donate flow reloads that same URL and clicks `+100 USD` again. The campaign donate flow reloads the same way, and clicks Donate again after each reload because that closes the dialog.

Selectors are ARIA/text/`name=` handles from the real UI (`getByRole("link", {name: "Log In"})` inside the banner, footer `Marketplace` inside `contentinfo`, `getByRole("button", {name: "+100 USD"})`, `input[name="email"]`, …). Add a flow by adding an entry to `FLOWS` in drive.mjs, a file in `features/`, and a README link to that file. `doctor.sh` fails when those three disagree.

## Evidence

`$VERIFY_OUT/`: `results.json` (per flow: `entry` with `clicked` and `loaded`, status pass|fail|blocked, observed facts, error, screenshots, ARIA snapshot paths, log), `<flow>[-step].png` full-page screenshots of each step (on failure `<flow>-final.png`) and a sibling `<flow>[-step].aria.txt` (Playwright's ARIA snapshot of `body` at that same moment), `<flow>.log` (browser console, page errors, every HTTP ≥400), `drive.txt`, `launch-doctor.log`, and every server log from the state dir (`dev.log`, `migrate.log`, `packages-build.log`, `stripe-stub.log`, `nonprofits-stub.log` — what was faked). `smoke-paths` issues HTTP requests and writes no png or aria file. The logs are copied before cleanup deletes the state dir whenever run.sh exits normally or on SIGINT (^C) or SIGTERM — the signals its trap catches. A SIGKILL (`kill -9`) can't be trapped, so it leaves both the logs and the state dir in place; the next run's pre-launch cleanup removes them.

Proof standards: clicks and typing for the entry points the flow lists as clicks, and a direct `goto` or `request.get` only for the URLs it lists as loads. No test endpoints. Capture each step, not just the end, and save the ARIA snapshot beside each screenshot. Check side effects (db-backed text on screen, stub log). A flow that can't run for want of secrets is `blocked` with the reason, never `pass`. Read the screenshots and the ARIA snapshots before claiming success.

## Cleanup

`scripts/cleanup.sh` (run.sh calls it before launch, and from its `EXIT`/`INT`/`TERM` trap — a normal exit, ^C or SIGTERM; not SIGKILL, which no trap can catch): kills the dev server **process group from `dev.pid`** (never by name), removes `.env.verify`, stops and deletes the throwaway Postgres (`KEEP_DB=1` keeps it), removes `/tmp/bg-verify`. It signals that group only while the pid's `/proc` start time still matches the `dev.starttime` launch.sh recorded; a missing or mismatched token means the pid exited or was reused, so it logs why and signals nothing. Never touches `$VERIFY_OUT`. It deletes `VERIFY_PG_DIR` only if pg-up.sh's `.verify-platform-owned` marker is in it, and exits 1 leaving the dir intact when the marker is missing or a running Postgres won't stop; run.sh then aborts with 3 before launching.

## Tests

For changes to these scripts: `tests/test-pg-pass-symlink.sh` (state-dir and `pg.pass` refusals; fast, uses `sudo -n` for the foreign-owner case), `tests/test-sigint-logs.sh [INT|TERM]` (a real run on spare ports, interrupted mid-drive; checks the logs reached `VERIFY_OUT` and everything stopped), and `tests/test-cleanup-pid-token.sh` (cleanup signals `dev.pid` only on a matching `dev.starttime`; fast, no postgres — but like any cleanup.sh run it deletes `.env.verify`, so not beside a live launch).

## Gotchas

- Don't wait for `networkidle`: Stripe.js/analytics keep retrying. Wait on a visible element.
- A cold dev server reloads when the footer first scrolls into view (`/donate/1` prefetch). The Marketplace click retries; do not "fix" that by loading `/marketplace` directly and calling the footer entry verified. The direct load is a separate entry and still runs after the click.
- With filler keys the browser shows "Express checkout failed to load" / "PayPal failed to load" and Stripe.js 401s — expected, logged, not a failure of these flows.
- `COREPACK_HOME` defaults to an unwritable `/usr/local/share/corepack` on the box; launch.sh sets `$HOME/.cache/corepack`.
- First run downloads nothing but needs `pnpm exec playwright install chromium` once (done on the box).
- Maintain: when a flow breaks because the UI changed (not a regression), fix drive.mjs + its feature file in the same change; when it's a product regression, report it — don't edit the check to pass.
