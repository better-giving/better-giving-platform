# Better Giving

Public monorepo (`AngelProtocolFinance/better-giving`). Turborepo + pnpm. The root is a thin turbo delegator with no app code. **Each member's own `CLAUDE.md` is the authority on that member — read it before working there.**

## Stack

Versions below are the pins in this repo. Do not bump them as part of unrelated work.

- **Node** is the `24` line. `.nvmrc` contains `24`. `engines.node` is `24.x` in the root `package.json` and in every member that declares `engines` (`platform`, `docs`, `emails-preview`, `design-sync`, `emails`, `@better-giving/ui`, `@better-giving/brand`, `@better-giving/paypal`). There is no patch pin. CI installs it with `actions/setup-node` and `node-version-file: .nvmrc`, which resolves a bare major to the current release of that line.
- **pnpm** is `12.4.2`. Root `package.json` `packageManager` is `pnpm@12.4.2`, and `pnpm-lock.yaml` `packageManagerDependencies.pnpm` is the same version. CI's `pnpm/action-setup` reads that field.
- **TypeScript** `5.9.3` and **`@types/node`** `24.13.6` come from the pnpm catalog in `pnpm-workspace.yaml`.
- **Toolchain at the root:** turbo `2.11.2`, `@biomejs/biome` `2.5.14`, lefthook `2.1.14`, vitest `5.0.0`.
- **`apps/platform`:** React Router `7.18.3` (`@react-router/fs-routes`, `@react-router/node`, `@react-router/dev`), React `19.2.6`, Vite `8.1.5`, Tailwind `4.3.1`, drizzle-orm `0.45.2`, drizzle-kit `0.31.10`, `@neondatabase/serverless` `1.1.0`, `@electric-sql/pglite` `0.4.5` (tests only), better-auth `1.6.22`, Playwright `1.63.0`.

## Layout

`apps/` = apps, `packages/` = internal libraries consumed via `workspace:*`. Members are declared in `pnpm-workspace.yaml`; a new one needs an entry there plus a `package.json` and a `tsconfig.json` extending `tsconfig.base.json` (built members included — they add emit config on top). Four apps deploy (`platform`, `blog`, `docs`, `emails-preview`); `design-sync` is local-only.

**Members with a `CLAUDE.md`** — their layout, build, public API and conventions live there, not here:

- **`apps/platform/`** — the web app (package `platform`). Read `apps/platform/CLAUDE.md` before writing app code: test cost, design system, UI sweeps, gotchas, skew protection. The layer boundaries are under Architecture below.
- **`apps/blog/`** — Sanity Studio; content source for platform's `/blog`. Read `apps/blog/CLAUDE.md` **before any `schemaTypes/` or `queries.ts` edit** — nothing guards against drift, and the edit is only half-done until its typegen step and the regenerated `blog-types` artifacts are staged with it. Local studio: `pnpm dev:blog` (port 3333, per that file).
- **`apps/emails-preview/`** — react-email preview site on its own Vercel project. Read `apps/emails-preview/CLAUDE.md` when adding a preview entry, bumping `react-email`, or touching its `vercel.json` — both the version floor and the `buildCommand` prefix are load-bearing. Dev server: `pnpm dev:emails-preview` (port 3001).
- **`packages/emails/`** — React Email templates, source-only, transpiled by platform. See `packages/emails/CLAUDE.md`.
- **`packages/paypal/`, `packages/chariot/`** — built server-side SDKs (`PayPalSDK`, `Chariot`) over `openapi-typescript` types, emitting via raw `tsc`. See each member's `CLAUDE.md`.
- **`packages/crypto/`, `packages/stocks/`** — built zero-dep data libs (crypto tokens + chains; stock tickers + broker-dealers), emitting via tsup. See each member's `CLAUDE.md`.

Two conventions those four built packages share, and a fifth would inherit: `src/generated/**` is **committed source** refreshed by an occasional `generate` script — never a turbo `output`, never deleted; and none carries a pre-commit `type-check` hook, because the package's build in turbo/CI is the type gate.

**Members with no `CLAUDE.md`** — this is their only documentation:

- **`apps/docs/`** — developer docs + donation-form embed showcase (private). React Router v7 SSR (`appDirectory: "src"`, `#/` → `src/`, fs-routes, Tailwind v4, shiki); `/forms/$id` iframes platform's donation form at various sizes. On `@better-giving/ui`'s stylesheet and token palette, so a raw tailwind palette name (`neutral-200`, `blue-600`) does not compile here either; it uses the shared `Copier`/`ExtLink`. **`routes/demo-nonprofit.tsx` is the one deliberate exception** — it impersonates a fictional nonprofit so the embedded form is seen in somebody else's design, so its brand colors come from the `--color-demo-*` set in `src/index.css` and must never be system tokens (its plain greys stay the semantic neutrals — grey is not an identity). Own Vercel project; only env is the optional `VITE_BG_FORM_ID`; no `test` task. Otherwise follows platform's conventions. Dev: `pnpm --filter docs dev` (no root alias; the repo does not pin a port).
- **`packages/brand/`** — the canonical Better Giving identity: legal identity (`LEGAL_NAME`/`EIN`/`ADDRESS`), `socials`, and the color palette. Source-only. The palette is **light-only** — the `.dark` set was deleted 2026-08-19 as unreachable (no toggle, no `prefers-color-scheme`); read `design-system.md` before re-deriving one. It ships twice for two consumers: `colors.css` (`:root`, real `oklch()`), `@import`ed verbatim by platform's `src/index.css`, and `colors.ts`, the flat-hex mirror the email templates need because mail clients can't `@import`. **`colors.test.ts` fails if the two drift**, so a new literal `oklch()` token in `:root` must land in `colors.ts` in the same commit; `var()`/`color-mix()` tokens have no email twin by rule. **`design-system.md` is the token ledger**, described where colors get reached for (`apps/platform/CLAUDE.md`).
- **`packages/ui/`** — the platform design system: shared React components, the CSS style layer, and pure TS helpers. Source-only for TS, with three export entries for three consumers: `.` (components, drags React), `./helpers` (pure TS), `./styles.css` (the source stylesheet platform's own single Tailwind pass `@import`s — this is *where the shared layer lives*, not how platform gets its CSS). It does build one CSS artifact (`pnpm --filter @better-giving/ui build` → `dist/styles.css`, gitignored) at a stable non-hashed path, for external tooling like design-sync that can't read a content-hashed Vite output. It also runs its own browser-mode vitest suite (`pnpm --filter @better-giving/ui test`, `packages/ui/vite.config.ts`): the same one-chromium-per-file cost as platform's but a fraction of the size, none of platform's setup files or mocks, so `platform-tests`' locator recipes carry over and its mocking does not.
- **`packages/types/blog/`** — package `blog-types`: blog's generated types + copied groq queries + hand-authored project coords. blog produces, platform consumes; platform never imports blog directly.
- **`apps/design-sync/`** — everything `/design-sync` needs to publish `packages/ui` to claude.ai/design: `.design-sync/` (`config.json`, `entry.tsx`, the per-component `docs/`, `NOTES.md`) and the converter's own deps. **Run every design-sync command from this directory** — the skill resolves `.design-sync/config.json` against the cwd, so a run started at the repo root reads no config, treats it as a first-time import, and creates a second claude.ai/design project; nothing at the root catches that (see `NOTES.md`). It is the one `apps/` member that does not deploy, on purpose (2026-08-21): `pnpm --filter design-sync preview` serves the emitted bundle locally, and a fifth Vercel project would rebuild on every root-level commit (see Deploy) for a look-at-it tool. Nothing enforces deployability for `apps/` membership — turbo keys on task names, Vercel on each project's Root Directory, biome/lefthook on explicit paths.

## Commands

Run these from the repo root. They are the root `package.json` scripts unless noted, and they are what `.github/workflows/ci.yml` runs.

| Step | Command | Where it runs |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | `checks` and `test`, after Node from `.nvmrc` and pnpm `12.4.2` |
| Lint | `pnpm lint` (`biome check .`) | `checks` |
| Typecheck | `pnpm typecheck` (`turbo run typecheck`) | `checks` |
| Playwright | `pnpm --filter platform exec playwright install --with-deps chromium` | `test`, immediately before the suite |
| Test | `pnpm test` (`turbo run test`) | `test` |
| Build | `pnpm build` (`turbo run build`) | not in CI — Vercel builds the apps |
| Dev | `pnpm dev` | local; platform only |
| Migrate | `pnpm --filter platform migrate` | local dev database; production is the `migrate` job in `.github/workflows/smoke.yml` |

Cursor cloud agents get Node, pnpm and the frozen install from `.cursor/install.sh` (`.cursor/environment.json`); its comments carry the nvm and `core.hooksPath` handling. It does not install Playwright — the Playwright row above does, matching CI.

`pnpm typecheck` depends on `^build` (`turbo.json`). That builds workspace dependencies that define `build` — including the dist-exporting packages platform's typecheck resolves types from (`@better-giving/paypal`, `@better-giving/chariot`, `@better-giving/crypto`, `@better-giving/stocks`) and `@better-giving/ui`'s CSS build. It does not run `platform`, `docs`, or `emails-preview`'s own `build`. CI says not to add `turbo run build` here: Vercel already builds the apps.

`pnpm test` runs every member that defines `test`: `platform` (`vitest --run --bail 1`), `@better-giving/ui` (same), and `@better-giving/brand` (`vitest --run`, the `colors.css` / `colors.ts` lockstep). Platform and ui run concurrently under turbo and each start Chromium (`fileParallelism: false` inside each project; ui sets `api.strictPort: false` so the two browser API servers do not collide). Scope one member with `pnpm --filter <pkg> test`. No env block is required: `apps/platform/.env.test` is committed throwaway filler and vitest loads it. Tests talk to `@electric-sql/pglite`, not Neon.

`pnpm dev` is `turbo run dev --filter=platform`, which runs `react-router dev`. Vite listens on port **4200** (`server.port` in `apps/platform/vite.config.ts`, `strictPort: true`). Other dev entry points: `pnpm dev:blog`, `pnpm dev:emails-preview`, and `pnpm --filter docs dev`.

**Migrations.** `pnpm --filter platform migrate` is `node --env-file-if-exists=.env .server/pg/migrate.ts` with the package directory as cwd. It runs the guard in `.server/pg/check-migrations.ts`, then drizzle-orm's migrator on `DATABASE_URL_UNPOOLED`, holding a Postgres advisory lock for that session (`.server/pg/migrate.ts`, `.server/pg/migrate-run.ts`). Because it loads `.env`, a bare run targets the dev database. Generate the committed artifact with `pnpm --filter platform exec drizzle-kit generate` (`apps/platform/drizzle.config.ts` writes `.server/pg/migrations`). `drizzle-kit push` is for fast iteration against that same dev `.env` only. Do not run `drizzle-kit migrate`: it skips the guard and the lock.

## Architecture

### `apps/platform`

Paths relative to `apps/platform/`. Three layers:

- **`src/`** — React Router routes, components, client code. Inside `src/`, use `#/` for cross-folder imports — routes are deeply nested (filesystem-routed), and `../../../components/foo` is worse than `#/components/foo`. Reserve relative paths for a route folder importing its own `./api` or `./schema`.
- **`lib/`** — shared business logic, types, schemas. Isomorphic.
- **`.server/`** — server-only code: pg schema, migrations, auth, queues.

Inside `lib/` and `.server/`, sibling imports are relative (`../foo`). `@/` and `$/` are for cross-layer imports only, so `lib/` stays portable and `.server/` stays coherent. Aliases come from `apps/platform/tsconfig.json` (Vite resolves them with `resolve.tsconfigPaths`).

Also present: `jobs/` (one-off jobs), `scripts/` (dev tooling), `plugins/`, `utils/`, `public/`. One-off scripts in `scripts/` and `jobs/` run with bun.

**Database:** Neon. Dev and staging share one branch; production is its own.

**Migrations are expand/contract**, because every migration lands while the previous deployment still serves traffic (Deploy → Production migration; preview/staging migrate in `postbuild`). An additive change ships with its code. A destructive one ships in a later release than the one that stopped reading the old shape (for a new `NOT NULL` column: the release that started writing it), with `-- contract: <sha> <what that release changed>` above that statement in its `.sql`, nothing but comments between — one marker per statement. `run_migrate` runs the guard first and stops, migrating nothing, on an unmarked destructive statement after `0045` (the grandfathered set, `LAST_GRANDFATHERED` in `.server/pg/migration-guard.ts`) or on a `_journal.json` drizzle-kit would silently skip. What counts as destructive is `RULES` in that file. `migration-guard.test.ts` runs the same check in CI's `test` job.

### Boundaries that cross members

- Platform reaches `@better-giving/ui` only through the package exports. App-specific UI stays in `apps/platform/src/components/`.
- Platform consumes `blog-types`. It does not import `apps/blog`.
- `packages/emails` exports source. Platform transpiles it. `apps/emails-preview` is the preview host and is the member that depends on `next`.
- Tailwind v4 `@theme` resets default palette colors. Use the semantic tokens from `packages/brand` / `packages/ui`. Raw palette names (`gray-500`, `blue-600`) do not compile in platform or docs.

## Conventions

- lefthook, biome, turbo, and `tsconfig.base.json` live at the root — repo-wide, not per-package.
- **TS topology:** `tsconfig.base.json` holds shared policy (strict, module/target, `noEmit`); every member extends it and layers on env/jsx/aliases/includes. There is no root `tsconfig.json` — tsc never opens the base standalone, which is why each lefthook type-check hook anchors on a member's config (`lefthook.yml` says which and why).
- **Biome:** the single root `biome.json` governs every member by upward traversal, and lint/format run as **one root pass** rather than fanning out through turbo — a deliberate exception to the turbo-delegator rule, because biome is a single repo-aware binary and a per-package fan-out can't reach root-level files (`turbo.json`, `tsconfig.base.json`). So `turbo.json` intentionally defines **no** `lint`/`format` task; turbo owns `build`/`test`/`dev`/`typegen`/`typecheck`. Per-member `lint`/`format` scripts exist only for granular `--filter` runs and inherit the same config. `**/package.json` is excluded because biome would collapse hand-maintained arrays. `**/*.svg` is excluded because biome lints SVG and its SVG rules land on icon assets — an icon's a11y decision belongs at the JSX site that renders it. `suspicious/noUndeclaredEnvVars` is `off` because every var it flags is a bundler builtin, test-only, or read by a script that is not a turbo task; declaring them in `turbo.json` would widen the build's env surface for vars the build never reads. (`biome.json` is strict JSON and can't carry comments — that's why this rationale lives here.)
- **`build` outputs must cover every artifact Vercel's build step reads, not just the app's own build dir.** A cache-hit build that drops one fails silently by construction: turbo reports success and Vercel ships whatever partial output survived. This already cost a deployment with no serverless function at all — see the `outputs` comments in `turbo.json`. When a member adds a Vercel preset or adapter, check what it writes on disk and list it.
- **A build env var only one member reads goes in that member's own `turbo.json`, never the root `tasks.build.env`.** Every root key hashes into every member's build, so a per-commit value there (`VERCEL_GIT_COMMIT_SHA`) misses the remote cache for every package on every commit. `apps/platform/turbo.json` carries the sha for platform alone, appending to the root list with `$TURBO_EXTENDS$` — without it the package array replaces the root's.
- **Pre-commit:** lefthook runs biome check plus per-member, staged-file-scoped tsc-files; `lefthook.yml` documents each hook's anchor and each deliberate omission. Let the hooks run — `--no-verify` is not the fix for a red one.
- **Package manager:** always `pnpm` — never npm, npx or yarn. Local bins are `pnpm <bin>` (or `pnpm exec`); one-shots are `pnpm dlx`. Pin new deps with `pnpm add <pkg> --save-exact` (no `^` / `~`).
- **Claude config:** a single root `.claude/`. Skills live at `.claude/skills/<name>/SKILL.md` (a directory with `SKILL.md`, never a bare `<name>.md`), always at root even when member-scoped — a skill under `apps/*/.claude` is directory-scoped and missing from `/` autocomplete. A member-scoped skill declares its jurisdiction in the body, and any `globs:` are repo-root-relative.

## Deploy

- **platform** — Vercel, Root Directory = `apps/platform`. No Ignored Build Step is set on any of the four Vercel projects linked to this repo (platform `angelprotocol-web-app`, `emails`, `bg-docs`, `better-giving-blog`); builds are skipped by Vercel's native affected-projects skip, preferred over an Ignored Build Step / `turbo-ignore` because the native skip doesn't occupy a build slot. Its blind spot: a change to any file outside the `pnpm-workspace.yaml` globs (`.claude/`, `.github/`, `.cursor/`, root `package.json`, `turbo.json`, `biome.json`, …) counts as global and deploys **all four** projects — and each preview/staging platform build migrates its database (`postbuild`). Builds run concurrently, which is why every migrate run serializes on a Postgres advisory lock.
- **emails-preview** — separate Vercel project (Root Directory = `apps/emails-preview`), building the preview site independently of platform. `emails` (the package) has no build and does not deploy.
- **CI gate** — `.github/workflows/ci.yml` runs `checks` (biome + `turbo run typecheck`) and `test`, plus `gate`, which concludes success only when both did. Vercel imports them as deployment checks on the platform project. The workflow comments its own trade-offs — trigger scope, the missing `paths:` / `if:` / `concurrency`, sha-pinned actions, the runner label, remote caching, why it never runs the apps' `build`, and that the job names are the check identifiers. Read those comments before editing the file. Which checks are required lives in the Vercel dashboard, not in the repo. The gate covers promotion to the production domain; the `staging` custom environment deploys without that gate.
- **Production migration** — a production build never migrates (`postbuild` runs only the migration guard when `VERCEL_ENV=production`). The `migrate` job in `.github/workflows/smoke.yml` does it instead, on Vercel's `vercel.deployment.ready` dispatch: it checks the sha is on `main`, waits for `ci.yml`'s `gate` to pass in `main`'s push run of that sha (30-minute ceiling; a `pull_request` run on the same sha is ignored), then either skips migrate — when the sha is over 250 commits behind `main`, or a newer `main` commit already has a platform production deployment queued, held, or live — writing commit status `failure` without failing the Actions run, or runs the guard and the locked migrate and only then lets the smoke job run. A commit that fails `checks` / `test` never migrates production. The URL is the `DATABASE_URL_UNPOOLED` secret of the GitHub environment `production-migrate` (deployment branches: `main`), not a repository secret. Smoke then requests `/`, `/api/currencies`, and `/form-embed.js` on the deployment URL and reports the commit status `smoke (<environment>)`.

## Git

- **`main` takes changes only through a pull request** (GitHub ruleset on `main`: pull request required, plus `deletion` + `non_fast_forward`), so a direct push is refused with GH013. Greptile does not review automatically; a PR comment `@greptileai` asks for one. Ask before adding a status-check rule.
- Base PRs on the current working branch, not a hardcoded `main`, when the work already has a branch.

## Never

- **Never commit a secret.** The repo is public. Gitignored on purpose: `.env`, `.env.local`, `.env.staging`, `.env.production`, `.env.production.local`, `.env.test.local`, `apps/platform/.env.verify`. The only committed env files are placeholders — `apps/platform/.env.example`, `apps/platform/.env.test` (its header says every value is throwaway filler), and `apps/docs/.env.example`. Do not put real credentials in those files, in `.cursor/environment.json`, in Dockerfiles, or in docs. `.cursor/install.sh` must stay free of tokens.
- **Never use production keys or the production database.** Do not point `DATABASE_URL` or `DATABASE_URL_UNPOOLED` at production, and do not run migrate, drizzle-kit, or a job against it. Production DDL is the `migrate` job in `.github/workflows/smoke.yml` only. `.env.production` is gitignored and deliberately has no `DATABASE_URL_UNPOOLED` for drizzle-kit.
- **Never edit a shipped migration.** SQL, `meta/_journal.json`, and snapshots under `apps/platform/.server/pg/migrations/` that are already on `main` are applied history. Add a new migration. Do not change a journal `when`: drizzle-kit skips a tag whose `when` is not after the previous tag wherever that previous tag has run.
- **Do not edit CI or deploy config unless asked.** That includes `.github/workflows/`, `vercel.json`, and turbo `build.outputs` / `build.env` that the Vercel build reads. Renaming the `checks`, `test`, or `gate` jobs changes the identifier Vercel matches.
- **Do not run `sanity deploy`.** Blog is the Vercel project `better-giving-blog`. `sanity deploy` creates a second, Sanity-hosted studio (`apps/blog/CLAUDE.md`).
