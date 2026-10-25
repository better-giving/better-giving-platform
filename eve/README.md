# Better Giving lead agent (eve)

An [eve](https://eve.dev/docs) agent that works as a lead engineer on this repository. A PM bot sends it a brief and a done-check over HTTP. The agent clones the repo in a Vercel Sandbox, plans the change, has subagents write failing tests and then the code, gets a read-only review, and opens a **draft** PR on a `bgp-lead/*` branch only after the review passes. It returns a short result the PM can act on.

It never merges, never deploys, never pushes to `main`, and never changes this `eve/` folder.

This folder is a standalone npm project. It is not part of the pnpm workspace, the root Turbo pipeline, or any app's tsconfig, so it doesn't affect the platform's install, build, or tests. The root Biome config does lint it.

> **TODO:** the shared subagents (test-writer, builders, hard-work, reviewer) and skills will move to a pinned Kru eve extension built by Kai. This folder will then mount that extension and keep only the Better Giving layer: repo settings, sandbox, guard, channel auth, and instructions.

## How a run works

1. **Start.** The PM bot (Ivy) calls the agent's authenticated route with a brief and a done-check. See [Starting a run](#starting-a-run).
2. **Plan.** The lead clones the repo, reads `AGENTS.md`, branches from `origin/main`, and splits the work into slices, noting which ones touch UI.
3. **Tests first.** `test-writer` commits failing tests for each slice.
4. **Build.** The lead sends UI slices to `ui-builder` and the rest to `non-ui-builder`. A builder that fails twice on a slice calls its own `hard-work` subagent.
5. **Check.** The lead runs `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
6. **Review.** `reviewer` reads the diff and returns `PASS` or `FIX` with at most 10 findings and a `Gated areas:` line. On `FIX`, the builder fixes and the reviewer looks again, up to 3 rounds.
7. **Draft PR.** On `PASS` only, the lead pushes the branch and opens a draft PR. After 3 rounds of `FIX` it opens nothing and returns `BLOCKED`.
8. **Result.** The run ends with `STATUS`, the PR URL, the gated areas, open findings, and done-check evidence.

### After the draft PR

The agent's job ends at the draft PR. Ivy checks the Vercel preview against the brief. She merges small ungated PRs herself under the team merge gate, and sends gated ones (UX, money paths, migrations, auth and security, CI or deploy config, public APIs, new dependencies, privacy, legal or pricing text) to Justin. The agent never merges. Ivy also keeps the tracker up to date; the agent doesn't touch Linear.

## Models

| Agent | Model ID | Route | Why |
| --- | --- | --- | --- |
| Lead | `deepseek/deepseek-v4.1-flash` | Token Pass, `AI_GATEWAY_API_KEY` | Fast, cheap coordination: planning, routing, and reading evidence. |
| `test-writer` | `zai/glm-5.3` | Token Pass | Careful, spec-driven test writing. |
| `ui-builder` | `moonshotai/kimi-k3` | Token Pass | Frontend and UI code. |
| `non-ui-builder` | `zai/glm-5.3` | Token Pass | Server, data, and library code. |
| `ui-builder__hard-work`, `non-ui-builder__hard-work` | `claude-opus-5-5` | Anthropic direct, `ANTHROPIC_API_KEY` | Slices a builder failed twice. |
| `reviewer` | `claude-opus-5-5` | Anthropic direct | Read-only review against the brief and the merge gate. |
| `code__worker` (eve `code` extension) | `moonshotai/kimi-k3` | Token Pass | Read-only exploration. |

- **Token Pass.** `AI_GATEWAY_API_KEY` must be a Token Pass key. It serves only the three featured models above, bills Token Pass credit, never falls back to gateway credits, and refuses every other model with a 403. DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash`) is the only DeepSeek model Token Pass offers. Gateway web search is off for the same reason.
- **Anthropic.** `hard-work` and `reviewer` use eve's direct Anthropic provider (`eve/models/anthropic`), which reads `ANTHROPIC_API_KEY` and bills the Anthropic account. They don't go through AI Gateway BYOK on purpose: BYOK retries failed requests on gateway credits, and that fallback can't be turned off. Set a monthly spend limit on the Anthropic key, since gateway budgets don't cover it.

## Starting a run

The agent serves eve's HTTP API at `/eve/v1`. Every route except `/eve/v1/health` needs auth: HTTP Basic with `EVE_BASIC_AUTH_USER` and `EVE_BASIC_AUTH_PASSWORD`, or a Vercel OIDC token from this project. Without the Basic variables, only OIDC gets in.

Start a session with the brief as its first message. Pass [`result-schema.json`](./result-schema.json) as `outputSchema` to get the result as structured data, and an `operationId` so a retried request doesn't start a second run.

```bash
curl -X POST "https://<deployment>/eve/v1/session" \
  -u "$EVE_BASIC_AUTH_USER:$EVE_BASIC_AUTH_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg brief "$BRIEF" --slurpfile schema result-schema.json \
        '{message: $brief, operationId: "JUS-123-run-1", outputSchema: $schema[0]}')"
# {"ok":true,"sessionId":"wrun_A","status":"accepted"}
```

The brief is plain text with the goal, any constraints, and a `Done-check:` list. If it has no done-check, the agent writes one and includes it in the result.

### Following a run

Stream the session's events as NDJSON:

```bash
curl -N "https://<deployment>/eve/v1/session/wrun_A/stream" -u "$EVE_BASIC_AUTH_USER:$EVE_BASIC_AUTH_PASSWORD"
```

- `result.completed` carries the structured result (`event.data.result`) when you sent `outputSchema`.
- `session.waiting` means the turn ended and the agent is waiting for a follow-up. Answer a question with `POST /eve/v1/session/wrun_A` and `{"message": "..."}`.
- To pick up where you left off, add `?startIndex=<count of events already read>`.
- `POST /eve/v1/session/wrun_A/cancel` stops the current turn.

From TypeScript, `eve/client` wraps these routes; `response.result()` returns the structured result.

### The result

| Field | Meaning |
| --- | --- |
| `status` | `PASS`: a draft PR is open and the reviewer passed it. `BLOCKED`: no PR; the findings or questions say why. |
| `prUrl` | The draft PR, or `null`. |
| `gatedAreas` | The reviewer's `Gated areas:` line: each merge-gate area the diff touches and its file, or `none`. |
| `openFindings` | Review findings still open, `SEV - what · file:line`. |
| `doneCheck` | Each done-check item with the command run and its result. |
| `questions` | Product calls the agent needs answered, each with a recommendation. |
| `summary` | What changes for users, in plain words. |

Without `outputSchema`, the final message has the same fields as text, starting with `STATUS: PASS` or `STATUS: BLOCKED`.

## What's in here

| Path | What it does |
| --- | --- |
| `agent/agent.ts` | The lead: model and settings. |
| `agent/instructions.md` | The lead's loop, result format, and hard limits. |
| `agent/subagents/test-writer/` | Writes the failing tests from the done-check before any code changes. Edits test files only. |
| `agent/subagents/ui-builder/` | Writes UI code until the tests pass, and applies review fixes. |
| `agent/subagents/non-ui-builder/` | Writes non-UI code until the tests pass, and applies review fixes. |
| `agent/subagents/*-builder/subagents/hard-work/` | Called only by its builder, after two failed attempts. |
| `agent/subagents/reviewer/` | Read-only review; returns `PASS` or `FIX`. |
| `agent/skills/` | `house-rules`, `testing`, and `reliable-work`, loaded by the lead. |
| `agent/extensions/` | eve's `code` extension (read-only worker) and `git` extension. |
| `agent/tools/bash.ts`, `agent/lib/guard.ts` | The shell, with refused commands. |
| `agent/tools/write_file.ts` | `write_file`, refusing paths under `eve/`. |
| `agent/lib/readonly.ts` | The reviewer's read-only shell allow-list. |
| `agent/lib/repo.ts` | The one repo the agent works in, its checkout path, and the protected folder. |
| `agent/sandbox.ts` | Vercel Sandbox setup: tooling, network allow-list, GitHub token brokering, and git hooks. |
| `agent/channels/eve.ts` | Auth for the HTTP API. |
| `result-schema.json` | The result shape a PM passes as `outputSchema`. |

## Safety

### Secrets

No secret is in this folder. `.env.example` lists variable names with empty values. Real values live only in the Vercel project's environment variables, which the app reads from `process.env`. The model never sees them.

The GitHub token stays in the app runtime. The sandbox gets a placeholder, and the sandbox firewall adds the real token only on requests to this repository on `github.com` and `api.github.com`. The sandbox can reach only GitHub and the npm registry.

### What the agent can't do

Enforced in code:

- **Merge or deploy.** The shell refuses `gh pr merge`, merge and write calls through `gh api`, `vercel` deploy and project commands, and `npm`/`pnpm publish`.
- **Push to `main`.** The shell refuses force, mirror, and delete pushes, pushes naming `main`, a bare `git push`, and pushing `HEAD`. A `pre-push` hook also refuses any push while on `main` or to `refs/heads/main`. That closes the `git push -u origin HEAD` gap.
- **Change `eve/`.** The shell refuses any command that names `eve/` in the checkout, and bulk staging (`git add -A`, `.`, `-u`, `git commit -a`). `write_file` refuses paths under `eve/`. A `pre-commit` hook refuses staged changes under `eve/`, and the `pre-push` hook refuses pushing any commit that touches it. The shell refuses `--no-verify` and changes to `core.hooksPath`.
- **Write as the reviewer.** The reviewer has no `write_file` and a shell limited to single read commands.

Only in the instructions: the 3-round review cap, "open the PR only on `PASS`", and `hard-work` after two failures. The reviewer also flags any change under `eve/` as a high finding.

The shell guard is a pattern match and could miss an unusual command. The real backstops are branch protection on `main` and `CODEOWNERS`, which assigns `/eve/` to its maintainers.

## Environment variables

Set these in the Vercel project. Never commit them.

| Variable | Required | What it is |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | Yes | A Token Pass AI Gateway API key. |
| `ANTHROPIC_API_KEY` | Yes | An Anthropic API key with a spend limit, for `hard-work` and `reviewer`. |
| `GITHUB_TOKEN` | Yes | A fine-grained GitHub token for this repository only: Contents read and write, Pull requests read and write, Metadata read. |
| `EVE_BASIC_AUTH_USER` | For Basic auth | Username for the HTTP API. |
| `EVE_BASIC_AUTH_PASSWORD` | For Basic auth | A long random password for the HTTP API. |

Vercel supplies `VERCEL_OIDC_TOKEN`, `VERCEL_PROJECT_ID`, and the team ID at runtime for sandboxes.

## Setup

1. **Protect `main`.** Require a pull request with an approval, require review from code owners, and block force pushes.
2. **Create the GitHub token** with the permissions above, scoped to this repository.
3. **Create the Token Pass key.** Vercel → AI Gateway → Token Pass → Create API Key.
4. **Create the Anthropic key** at console.anthropic.com and set a monthly spend limit.
5. **Create the Vercel project.** Import this repository, set Root Directory to `eve`, and keep the default framework preset. Node 24 comes from `engines`.
6. **Add the environment variables** above.
7. **Deploy** with `npx eve deploy` from this folder, or through the project's Git integration.
8. **Try it.** Start a run with a small brief and check that a draft PR appears on a `bgp-lead/*` branch and nothing landed on `main`.

## Local development

Needs Node 24.

```bash
cd eve
npm ci
npx tsc
npx eve build --skip-sandbox-prewarm   # compile check without Vercel credentials
npx eve link && npx eve dev            # full local run, needs a linked Vercel project
```
