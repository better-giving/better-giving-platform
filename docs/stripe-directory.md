# Stripe Directory listing

What a Stripe Directory listing for Better Giving needs, and where each field
comes from.

Per [Stripe's Directory page](https://docs.stripe.com/directory) (section
"List your company in Stripe Directory"), checked 2026-10-29, while the
feature is in preview:

1. **Public Stripe profile.** Published in the Stripe Dashboard, not in this
   repo. Publishing it is what puts Better Giving in Directory search.
2. **Agent / MCP listing.** Register an email in that page's "Be discoverable
   and payable by agents" form; Stripe then gets in touch about the listing.
   Stripe publishes no field list for this step, so the table below is what we
   keep ready for that conversation.

## Submission fields

Take the account id, profile handle and payment methods from the **live**
account, never from a sandbox.

| Field | Value |
| --- | --- |
| Business name | Better Giving (legal name: Better Giving, Inc.); match the public profile's display name |
| Stripe account id | `acct_XXXXXXXXXXXXXXXX` (placeholder: Dashboard → Settings → Account) |
| Stripe profile | `@<handle>`, shown as `https://stripe.com/@<handle>` (placeholder: from the public profile once it exists) |
| llms.txt | https://better.giving/llms.txt (also served at `/llm.txt`) |
| Agent guide | https://better.giving/agents |
| Agent skill | https://better.giving/agents/skill.md |
| MCP server card | https://better.giving/.well-known/mcp.json |
| MCP endpoint | https://better.giving/agents/mcp (JSON-RPC over HTTP POST) |
| MCP tools | `find_nonprofit`, `quote_donation`, `donate`, `donation_status` |
| Payment methods | Stripe-hosted Checkout, one-time USD. The session does not set `payment_method_types`, so the methods offered are the ones enabled under Dashboard → Settings → Payment methods (shared with Elements). List the methods actually enabled there. The quote prices the processing fee at the card rate, so a non-card method can cost a different fee than quoted. |
| Example prompts | The three under "Example donor prompts" in llms.txt |

## Where the URLs come from

- `apps/platform/public/llm.txt` is served at `/llm.txt` and, through
  `apps/platform/src/routes/[llms.txt].ts`, at `/llms.txt`. It is written by
  hand. Its test checks only that every tool name and the endpoint appear in
  it, so edit its tool text whenever a tool changes.
- The skill (`/agents/skill.md`) and the server card
  (`/.well-known/mcp.json`) are generated from the tool list in
  `apps/platform/src/routes/agents/tools.ts`, the same list the MCP endpoint
  returns from `tools/list`.
- The agent guide (`/agents`) is `GUIDE` in that same file. It is written by
  hand, so a tool change needs a matching edit there.
- Nonprofit profiles (`/org/:org`) and campaign pages (`/org/:org/:campaign`,
  `/campaigns/:fund_id`) carry schema.org JSON-LD that links back to the
  guide, the MCP endpoint and llms.txt.
