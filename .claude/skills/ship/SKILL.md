---
name: ship
description: Take the current branch from finished work to landed — look-back and fix (`kru:reflect`), text pass (`kru:text-fix`), then by verb `pr` (default; Greptile to 5/5 + green CI, then squash-merge), `main` (squash straight onto `main`), or `branch` (push the branch, stop).
argument-hint: "[pr|main|branch]"
disable-model-invocation: true
---

# ship

Runs on the branch checked out now, against `main`. The first argument is the verb; none means `pr`. Words after the verb are the user's notes for this run.

| verb | lands where | after steps 1–2 |
| --- | --- | --- |
| `pr` | `main`, through a reviewed PR | steps 3–5 |
| `main` | `main`, directly | step M |
| `branch` | the branch only | push the branch, report, stop |

Invoking this skill is the approval for every outward step its verb names: pushing the branch; for `pr`, opening the PR, posting `@greptileai`, and merging on a 5/5 with green CI; for `main`, pushing the squashed commit to `main`. Nothing else is approved — a step that needs more (a migration, a force-push, a product call a finding raises) stops and asks.

## 1. Look back

Run `kru:reflect` on the branch's own work (`main...HEAD`). It lands the fixes it scopes as commits.

If that round landed any commit, run `kru:reflect` again over just those commits. Repeat until a round lands nothing, at most 3 rounds; past that, stop and report what keeps coming back.

## 2. Text pass

Run `kru:text-fix` on the branch. Commit what it changes.

## M. Straight to `main` (verb `main`)

`main` takes direct pushes (root `AGENTS.md` → Git), so no CI gates this before it lands — the local run is the gate:

1. Run `pnpm lint`, `pnpm typecheck`, and the changed files' tests plus any conformance sweep the change's classes reach (`apps/platform/CLAUDE.md` → UI). All green, or fix and rerun.
2. Fetch `main`, then on a local `main` at `origin/main`: `git merge --squash <branch>`, one commit whose message says what changes for someone using the product, and `git push origin main`. A rejected push means `main` moved: fetch, redo the squash on the new tip, rerun step 1 for what changed. Never force.
3. Push the branch too, so it carries the work.
4. `ci.yml` runs on the push to `main`, and its `gate` is what promotes production. Read `checks`, `test` and `gate` on that sha. Red is a fix-forward on `main` the same way, never a revert without asking.

## 3. Open the PR (verb `pr`)

Push the branch, then open the PR against `main`. The body says what changes for someone using the product, with the design artifact link when there is one; the record (seats, findings, test counts) stays out. Subscribe to its activity (`subscribe_pr_activity`).

## 4. Wait for the review

Greptile reviews a new PR on its own, so the wait starts the moment the PR is open, and the subscription's events wake the session. Greptile posts a summary comment whose heading reads `Confidence Score: N/5` (also `<!-- greptile_confidence_score:N -->`), plus inline threads. CI is `checks`, `test`, and `gate` (`.github/workflows/ci.yml`).

## 5. Merge, or fix and ask again

Read the score on the **current head** — the summary's "Last reviewed commit" must be the PR's head sha.

- **5/5 and `gate` green on that head** → merge (squash, `expectedHeadSha` set to that head), then unsubscribe.
- **Below 5/5, or CI red** → for each Greptile thread and each failing check:
  - Verify the finding before fixing it. One that doesn't hold gets a reply saying why.
  - Fix, run the changed files' tests, `pnpm typecheck` and `pnpm lint` (root `AGENTS.md` → Commands), and push.
  - Reply on each thread naming the commit, and resolve it.
  - Post a standalone PR comment `@greptileai`, which is what re-runs a review after the first, then back to step 4.

  CI stops at the first failing test file, so after a red `test`, run the whole platform suite locally before pushing — a second failure may be hiding behind the first.

A push refused with 403 means GitHub access is missing: say so once, with the reconnect link from the error, and wait.
