# Stripe Directory listing

What a Stripe Directory listing for Better Giving needs, and where each field
comes from. Nothing here is submitted automatically.

Two parts:

1. **Public Stripe profile.** Created in the Stripe Dashboard, not in this repo.
2. **Agent / MCP listing.** An email to Stripe with the fields below.

## Submission fields

| Field | Value |
| --- | --- |
| Business name | Better Giving |
| Stripe account id | `acct_XXXXXXXXXXXXXXXX` (placeholder: Dashboard → Settings → Account details) |
| Stripe profile id | `XXXXXXXX` (placeholder: from the public profile once it exists) |
| llms.txt | https://better.giving/llms.txt (also served at `/llm.txt`) |
| Agent guide | https://better.giving/agents |
| Agent skill | https://better.giving/agents/skill.md |
| MCP server card | https://better.giving/.well-known/mcp.json |
| MCP endpoint | https://better.giving/agents/mcp (JSON-RPC over HTTP POST) |
| MCP tools | `find_nonprofit`, `quote_donation`, `donate`, `donation_status` |
| Payment methods | Stripe-hosted Checkout, one-time USD. The methods offered are the ones enabled on the account's Checkout payment method settings, because the session does not pin `payment_method_types`. Confirm the list in the Dashboard before sending. |
| Example prompts | See below |

## Example prompts

Swap the placeholders for a nonprofit that is live on the marketplace before
sending.

1. "Donate $25 to <nonprofit name> on Better Giving and send me the checkout link."
2. "Give $100 to the nonprofit with EIN <9-digit EIN>. No tip, but cover the card fee."
3. "Did my donation go through? Check the status of the donation you started for me."

## Where the URLs come from

- `apps/platform/public/llm.txt` is served at `/llm.txt` and, through
  `apps/platform/src/routes/[llms.txt].ts`, at `/llms.txt`.
- The guide, skill and server card are generated from the tool list in
  `apps/platform/src/routes/agents/tools.ts`, the same list the MCP endpoint
  returns from `tools/list`. Change a tool there and every document follows.
- Nonprofit profiles (`/org/:org`) and campaign pages (`/org/:org/:campaign`)
  carry schema.org JSON-LD that links back to the guide, the MCP endpoint and
  llms.txt.
