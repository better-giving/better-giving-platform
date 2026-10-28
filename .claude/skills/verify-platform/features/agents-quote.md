# Agent donation amounts

`find_nonprofit` lists each listed nonprofit's own preset amounts (`increments`, from its donation settings) and `quote_donation` names the label of an amount that is one of them. This flow is HTTP only: it does not open a document and it does not click.

## Sub-features
- `POST /agents/mcp` `tools/call` `find_nonprofit` with query `Verify Campaign Nonprofit` returns that nonprofit with `increments` `[{ amount: 25, label: "Fixture: feed a child" }, { amount: 100, label: "Fixture: plant a grove" }]`: sorted by amount, and the stored `abc` value dropped.
- `quote_donation` for that nonprofit at `25` returns `increment_label` `Fixture: feed a child`.
- `quote_donation` at `30` returns `increment_label` `null`.

## How to get to it (user POV)
- These are direct requests, not clicks. The drive POSTs JSON-RPC to `/agents/mcp`.

## Driving it with drive.mjs
- `node scripts/drive.mjs agents-quote` records the three POSTs. A non-200, a refused quote, increments that differ, or a wrong label fails the flow.
- No screenshot and no ARIA snapshot: nothing is rendered. Proof is `agents-quote.log` and the `loaded` list in `results.json`.

## Gotchas
- `scripts/seed.sql` stores the increments on `Verify Campaign Nonprofit` (`VERIFY0003`) as `100`, `25`, `abc`. That nonprofit's own donate form is not driven by any browser flow, and its campaign carries its own increments, so the seed changes no rendered flow.
- `agents-find` covers the other half: `Verify Test Nonprofit` has no increments and lists `[]`.
