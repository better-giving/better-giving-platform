---
name: to-review
description: Take the current branch from finished work to merged — look-back and fix (`kru:reflect`), text pass (`kru:text-fix`), open the PR, then loop on Greptile's review until it scores 5/5 and CI is green, and merge.
disable-model-invocation: true
---

# to-review

Runs on the branch checked out now, against `main`. Invoking this skill is the approval for every outward step below: pushing the branch, opening the PR, posting `@greptileai`, and merging on a 5/5 with green CI. Nothing else is approved — a step that needs more (a migration, a force-push, a product call a finding raises) stops and asks.

## 1. Look back

Run `kru:reflect` on the branch's own work (`main...HEAD`). It lands the fixes it scopes as commits.

If that round landed any commit, run `kru:reflect` again over just those commits. Repeat until a round lands nothing, at most 3 rounds; past that, stop and report what keeps coming back.

## 2. Text pass

Run `kru:text-fix` on the branch. Commit what it changes.

## 3. Open the PR

Push the branch, then open the PR against `main` with the GitHub MCP tools. The body says what changes for someone using the product, with the design artifact link when there is one; the record (seats, findings, test counts) stays out. Subscribe to its activity (`subscribe_pr_activity`).

## 4. Wait for the review

Greptile reviews a new PR on its own; don't comment to start it. Events wake the session — don't poll. Greptile posts a summary comment whose heading reads `Confidence Score: N/5` (also `<!-- greptile_confidence_score:N -->`), plus inline threads. CI is `checks`, `test`, and `gate` (`.github/workflows/ci.yml`).

## 5. Merge, or fix and ask again

Read the score on the **current head** — the summary's "Last reviewed commit" must be the PR's head sha.

- **5/5 and `gate` green on that head** → merge (squash, `expectedHeadSha` set to that head), then unsubscribe.
- **Below 5/5, or CI red** → for each Greptile thread and each failing check:
  - Verify the finding before fixing it. One that doesn't hold gets a reply saying why.
  - Fix, run the changed files' tests, `pnpm typecheck` and `pnpm lint` (root `AGENTS.md` → Commands), and push.
  - Reply on each thread naming the commit, and resolve it.
  - Post a standalone PR comment `@greptileai`, which is what re-runs a review after the first, then back to step 4.

  CI stops at the first failing test file, so after a red `test` run the whole platform suite locally before pushing — a second failure may be hiding behind the first.

A push refused with 403 is a GitHub access problem, not a retry: say so once, with the reconnect link from the error, and wait.
