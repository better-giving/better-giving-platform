# Agent donation amounts

`find_nonprofit` returns each listed nonprofit's own preset amounts (`increments`, from its donation settings) and `quote_donation` names the label of an amount that is one of them. This flow is HTTP only: it does not open a document and it does not click.

## Sub-features
- `POST /agents/mcp` `tools/call` `find_nonprofit` with query `Verify Campaign Nonprofit` returns that nonprofit with `increments` `[{ amount: 25, label: "Fixture: feed a child" }, { amount: 50, label: "" }, { amount: 100, label: "Fixture: plant a grove" }]`: sorted by amount, the stored `abc`, `0` and `1` (under the $2 minimum) dropped, and the blank label kept as `""`.
- `quote_donation` for that nonprofit at `25` returns `increment_label` `Fixture: feed a child`, and at `100` (the largest amount, stored first) `Fixture: plant a grove`.
- `quote_donation` at `50` returns `increment_label` `null`: the amount is a preset but its label is blank.
- `quote_donation` at `30` returns `increment_label` `null`: the amount is not a preset.

## How to get to it (user POV)
- These are direct requests, not clicks. The drive POSTs JSON-RPC to `/agents/mcp`.

## Driving it with drive.mjs
- `node scripts/drive.mjs agents-quote` records the five POSTs. A non-200, a refused quote, increments that differ, or a wrong label fails the flow.
- No screenshot and no ARIA snapshot: nothing is rendered. Proof is `agents-quote.log` and the `loaded` list in `results.json`.

## Gotchas
- `scripts/seed.sql` stores the increments on `Verify Campaign Nonprofit` (`VERIFY0003`) as `100`, `25`, `abc`, `0`, `1`, `50` (blank label). The update only fills a null column, so a database kept with `KEEP_DB=1` from an older seed keeps its old list: relaunch without `KEEP_DB=1` before trusting an "increments differ" failure. That nonprofit's own donate form is not driven by any browser flow, and its campaign carries its own increments, so the seed changes no rendered flow.
- `agents-find` covers the other half: `Verify Test Nonprofit` has no increments and lists `[]`.
