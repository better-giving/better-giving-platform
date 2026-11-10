---
name: db-admin
description: Use when the user asks to update, query, inspect, or fix database records — e.g. "make user X admin", "check donations for Y", "ban user Z", "pg dev/staging/prod"
---

# DB Admin

**Jurisdiction: `apps/platform/`.** Every path here — `.env*`, `.server/pg/schema/`, `drizzle.config.ts`, `package.json` — is relative to `apps/platform/`; `cd apps/platform` before running anything below.

## Overview

Ad-hoc PostgreSQL operations against the dev/staging or production databases via `psql`.

## When to Use

- User mentions "pg", "db", "database", "sql" with an action
- User asks to change user roles, ban/unban, inspect records
- User references "local", "dev", "staging" or "prod" database

## Connection

One env file per target, each exposing the same key name (`DATABASE_URL`):

| file | target |
|------|--------|
| `.env` | dev — neon `ep-cold-water-aqmhc1lt` |
| `.env.staging` | staging — **same neon branch as dev** (see below) |
| `.env.production` | prod — neon `ep-empty-cherry-aq287pca` |

```bash
# dev
psql "$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"

# staging
psql "$(grep -m1 '^DATABASE_URL=' .env.staging | cut -d= -f2- | tr -d '"')"

# production — ALWAYS confirm before writes
psql "$(grep -m1 '^DATABASE_URL=' .env.production | cut -d= -f2- | tr -d '"')"
```

**Do not `source` these files, and do not `source <(grep ...)` either.** Every
`DATABASE_URL` value is unquoted and contains `&` (neon appends
`?sslmode=...&channel_binding=...`), so the shell parses it as a background-job
operator and the assignment fails — as do unquoted values with spaces elsewhere
in `.env`. The command-substitution form above sidesteps the shell entirely.

`env "$(grep ...)" psql "$DATABASE_URL"` does **not** work either: the current
shell expands `$DATABASE_URL` before `env` sets it, so psql gets an empty string
and falls back to a local socket ("database `<username>` does not exist").

**dev and staging are currently the same neon branch** — `.env` and
`.env.staging` hold byte-identical `DATABASE_URL` values. Re-check with:

```bash
diff <(grep -m1 '^DATABASE_URL=' .env) <(grep -m1 '^DATABASE_URL=' .env.staging)
```

A migration or backfill "tested on staging" is therefore not isolated from dev,
and dev data is what staging deploys read. Treat them as one environment until
a separate branch exists.

## Quick Reference

| task | sql |
|------|-----|
| find user | `SELECT id, email, role FROM "user" WHERE email = '...'` |
| set role | `UPDATE "user" SET role = '...' WHERE email = '...' RETURNING id, email, role` |
| ban user | `UPDATE "user" SET banned = true WHERE email = '...' RETURNING id, email, banned` |

Schema files: `.server/pg/schema/` (drizzle). Read the relevant file for column names beyond `user`.

## Migrations

### Env var conventions (migrations)

- **`DATABASE_URL`** → the target for that env file. runtime + `psql` + backfills.
- **`DATABASE_URL_UNPOOLED`** → unpooled connection read by `drizzle.config.ts` (drizzle-kit needs a non-pooled URL for DDL). Present in `.env` and `.env.staging`; **absent from `.env.production`** — running drizzle-kit against prod from a laptop has no configured URL, which is deliberate: prod DDL goes through the release `migrate` job, not by hand.
- **Prod is `.env.production`'s own `DATABASE_URL`.** No variable inside another env file names prod, so a script cannot detect its own target — a guard written that way passes silently and runs. There is no `--env` flag on any runner here (bun/node take `--env-file`, drizzle-kit takes `--config`). Name the file at the call site — that act is the acknowledgement:

  ```bash
  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.production | cut -d= -f2- | tr -d '"')" bun jobs/<job>.ts
  ```

  Note bun auto-loads `.env`, so a job run with no explicit `DATABASE_URL` hits **dev**, silently.

### How migrations actually reach each env

Every run goes through `pnpm --filter platform migrate` (`.server/pg/migrate.ts`): the migration guard, then drizzle-orm's migrator in-process under a postgres advisory lock held on the same session, so concurrent runs against one database apply one at a time and a killed run frees the lock and rolls back together. It refuses a `-pooler` or unparseable `DATABASE_URL_UNPOOLED`. A run waits at most 10min for another run's lock, then exits 1 naming the holder's pid (`pg_stat_activity` / `pg_terminate_backend` it if that session is dead). Each DDL statement waits at most 5s for its table lock — the previous deployment is serving — and the whole run rolls back and retries, 4 tries in all; a table still locked after that fails the run with `lock timeout` in the log: find the long transaction on that table, not a migration bug.

- push to `staging` → the `staging` custom environment's Vercel build `postbuild` migrates whatever `DATABASE_URL_UNPOOLED` that environment holds (the dev/staging branch)
- Platform previews → the same `postbuild`, but on the Neon branch `test-e2e-better-giving` (endpoint `ep-cold-paper`), not `staging`; `staging` is only the name of the staging custom environment
- land on `main` → the production **build does not migrate** (its `postbuild` only runs the guard); `.github/workflows/smoke.yml`'s `migrate` job migrates prod once `checks`/`test` pass for that commit, and `smoke (production)` reports only after it

Locally, `drizzle-kit generate` produces the committed artifact; `drizzle-kit push` is for fast dev iteration only. Always `generate` so the journal and the artifact CI applies stay in sync.

### Safe migration workflow (multi-phase)

1. **column addition** — add new nullable column only (no FK, no rename, no drop). edit schema → `drizzle-kit push` (against `.env` = neon dev) → `drizzle-kit generate` (migration artifact) → commit to CI
2. **data migration / backfill** — backfill new column from old, clean orphan rows. run against dev first, then prod by passing `.env.production`'s `DATABASE_URL` inline (see the env var conventions above)
3. **code changes + schema enforcement** — rename refs in codebase, add FK constraints, drop old column. **phase 2's backfill must have run against prod before this migration merges** — the release `migrate` job applies every pending migration in one run, so a `SET NOT NULL` that ships alongside its own `ADD COLUMN` fails on unbackfilled rows, the job goes red, and the commit never reaches production — while `smoke (production)` is a required check in the Vercel dashboard, which the repo can't show. verify on neon dev + preview CI, then merge

### Notes

- dev uses `drizzle-kit push` (not migrate) — but migration journal must stay in sync; always also run `drizzle-kit generate` to produce the artifact CI will apply to prod
- `push` applies DDL without a journal entry, and dev and staging are one branch — so a pushed change leaves the shared branch ahead of the journal, and the next staging deploy's `postbuild` migrate re-applies it
- `pnpm --filter platform migrate` loads `.env`, so a bare run targets dev. to target another file, pass the value inline (an inline value wins over `.env`). never a bare `pnpm exec drizzle-kit migrate` — it skips the guard and the lock and races any build migrating the same branch:
  ```bash
  DATABASE_URL_UNPOOLED="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.staging | cut -d= -f2- | tr -d '"')" pnpm migrate
  ```
- the runner logs the failing statement and its postgres error. to dig further, `psql -f` the `.sql` against a throwaway neon branch, to read the error only — against a shared branch it bypasses the lock and the journal, and the next run re-applies it
- **data migrations**: run against neon dev first to catch constraint violations (e.g. check constraints on rows with null new-columns)

## Rules

1. Quote reserved-word identifiers (`"user"`, `"order"`, etc.)
2. Always `RETURNING` on mutations
3. **Production writes**: show SQL, wait for explicit user approval before executing
4. Look up schema in `.server/pg/schema/` when unsure of columns
5. **State which env file a command reads before executing it.**
