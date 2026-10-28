# Agent nonprofit lookup

`find_nonprofit` on the public MCP endpoint returns marketplace matches and, separately, IRS-verified nonprofits that are not on Better Giving. This flow is HTTP only: it does not open a document and it does not click.

## Sub-features
- `POST /agents/mcp` `tools/call` `find_nonprofit` with query `Verify Test Nonprofit` returns that seeded nonprofit in `items`, with `increments` `[]` (it sets none).
- The same response includes EIN `990000001` in `not_on_better_giving` with `donatable: false`, `status: "not_on_better_giving"`, an `onboarding_url` ending in `/register`, and no `id`.
- EIN `990000002` (the stubbed revoked org) is absent.
- `POST /agents/mcp` `tools/call` `quote_donation` with `recipient_id` `990000001` is refused (`invalid_input`).

## How to get to it (user POV)
- These are direct requests, not clicks. The drive POSTs JSON-RPC to `/agents/mcp`.

## Driving it with drive.mjs
- `node scripts/drive.mjs agents-find` records both POSTs. A non-200, a missing seeded name, a missing flag, a leaked revoked org, or a quote that is not `invalid_input` fails the flow.
- No screenshot and no ARIA snapshot: nothing is rendered. Proof is `agents-find.log`, `nonprofits-stub.log`, and the `loaded` list in `results.json`.
- While `NONPROFITS_API_KEY` is the `.env.test` filler, `scripts/nonprofits-stub.mjs` answers `nonprofits.better.giving` in-process. Any other key leaves that host alone.

## Gotchas
- The seeded nonprofit is `Verify Test Nonprofit` (`registration_number` `VERIFY0001`). The query has to match that name.
- The stub's eligible EIN is `990000001` and its revoked EIN is `990000002`. A real key makes the stub inert, so this flow only proves the fallback with the filler key.
