export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = {
  name: "better-giving",
  version: "1.0.0",
} as const;

export const GUIDE = `# Better Giving agent donations

Connect to the remote MCP server at \`https://better.giving/agents/mcp\` for
one-time USD donations. This page is its agent guide.

## Laira skill

1. Ask the donor for a nonprofit name or EIN and call \`find_nonprofit\`. Entries in \`not_on_better_giving\` are not on Better Giving and cannot take a donation. Tell the donor, share \`onboarding_url\` so the nonprofit can join, and never call \`quote_donation\` with them. If \`external_lookup\` is \`invalid_query\`, ask for a nonprofit name of at least two characters or a 9-digit EIN. If it is anything else besides \`ok\` or \`not_found\`, say the IRS lookup is temporarily unavailable rather than saying the nonprofit was not found.
2. Confirm the recipient, donation amount, whether to add a 10%, 15%, 20%, or no Better Giving tip, and whether to cover the card fee.
3. Call \`quote_donation\` and show every amount returned. If the recipient refuses tips, ask again without one. If the nonprofit requires a mailing address, this checkout cannot take the gift.
4. Collect the donor's first name, last name, and email, then call \`donate\` with the unchanged quote token.
5. Give the donor the Stripe-hosted checkout link. Better Giving never receives card numbers.
6. Poll \`donation_status\` with the donation id until it is settled or expired. A declined card leaves Checkout open. \`expired\` means it lapsed. Call \`donate\` again with the same quote token to open a new Checkout, until the quote itself expires (one hour); then request a new quote.

Send \`Authorization: Bearer\` with the agent token when you have one. The hourly cap is per token, and otherwise per trusted client address.

Repeated \`donate\` calls with the same quote token and an open Checkout return that Checkout and do not create another charge. Quote tokens are signed: send them back unchanged.
`;

export const tools = [
  {
    name: "find_nonprofit",
    description:
      "Find a Better Giving nonprofit by name or US EIN. IRS-verified 501(c)(3)s that are not on Better Giving come back in not_on_better_giving and cannot take a donation: tell the donor and share onboarding_url, and never pass them to quote_donation. If external_lookup is invalid_query, ask for a name of at least two characters or a 9-digit EIN. If external_lookup is not ok, not_found, or invalid_query, the IRS lookup is temporarily unavailable.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, ein: { type: "string" } },
      anyOf: [{ required: ["query"] }, { required: ["ein"] }],
    },
  },
  {
    name: "quote_donation",
    description:
      "Quote a one-time USD donation, including tip and optional card-fee coverage.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_id: {
          oneOf: [{ type: "integer", minimum: 1 }, { type: "string" }],
        },
        amount: { type: "number", minimum: 2 },
        currency: { const: "USD" },
        frequency: { const: "one-time" },
        tip_percent: { enum: ["none", "10", "15", "20"] },
        cover_processing_fee: { type: "boolean" },
        program_id: { type: "string" },
      },
      required: ["recipient_id", "amount"],
    },
  },
  {
    name: "donate",
    description:
      "Create or recover a Stripe-hosted Checkout Session for an unchanged quote.",
    inputSchema: {
      type: "object",
      properties: {
        quote_token: { type: "string" },
        donor: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            first_name: { type: "string" },
            last_name: { type: "string" },
          },
          required: ["email", "first_name", "last_name"],
        },
      },
      required: ["quote_token", "donor"],
    },
  },
  {
    name: "donation_status",
    description:
      "Read the status and amounts of an agent donation without donor details.",
    inputSchema: {
      type: "object",
      properties: { donation_id: { type: "string", format: "uuid" } },
      required: ["donation_id"],
    },
  },
] as const;
