---
name: browser-tests-ipv4
description: platform browser-mode vitest runs on this machine need only NODE_OPTIONS=--dns-result-order=ipv4first, no throwaway 127.0.0.1 config
metadata:
  type: project
---

`NODE_OPTIONS=--dns-result-order=ipv4first pnpm vitest run <file.test.tsx>` from `apps/platform` runs chromium tests fine here (2026-11-05); the throwaway vitest config binding 127.0.0.1 that briefs offer was not needed.

**Why:** briefs suggest the config as a fallback; skipping it saves a create/delete step.
**How to apply:** try the env var alone first; only add a config if the browser api server fails to connect.
