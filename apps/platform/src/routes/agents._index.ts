import type { ActionFunction, LoaderFunction } from "react-router";
import {
  AgentDonationError,
  create_quote,
  donate,
  donation_status,
  find_nonprofit,
} from "./agents/engine";

const GUIDE = `# Better Giving agent donations

Connect to the remote MCP server at \`https://better.giving/agents/mcp\` for
one-time USD donations. This page is its agent guide.

## Laira skill

1. Ask the donor for a nonprofit name or EIN and call \`find_nonprofit\`. \`items\` holds only listed nonprofits whose name matches: \`match\` is \`exact\` when one is the name asked for, \`close\` when the closest are similar names (confirm which one with the donor), and \`none\` when no listed name matches, so do not offer an unrelated nonprofit instead. Entries in \`not_on_better_giving\` are not on Better Giving and cannot take a donation. Tell the donor, share \`onboarding_url\` so the nonprofit can join, and never call \`quote_donation\` with them. If \`external_lookup\` is \`invalid_query\`, ask for a nonprofit name of at least two characters or a 9-digit EIN. If it is anything else besides \`ok\` or \`not_found\`, say the IRS lookup is temporarily unavailable rather than saying the nonprofit was not found.
2. Confirm the recipient, donation amount, whether to add a 10%, 15%, 20%, or no Better Giving tip, and whether to cover the card fee. Each listed nonprofit carries \`increments\`: preset amounts, smallest first, each with a \`label\` written by the nonprofit itself. When the list is not empty, offer those amounts with their labels as the choices, plus a custom amount. An increment whose \`label\` is empty is offered as the amount alone. Only when the list is empty, offer $10, $25, $50, $100, or a custom amount. Present each label as the nonprofit's own words, and never invent or embellish what an amount achieves.
3. Call \`quote_donation\` and show every amount returned, including \`breakdown\`: what is charged and what the nonprofit receives after fees. \`increment_label\` is the nonprofit's label when the amount is exactly one of its increments with a label, and null otherwise; when it is null, state the amount alone. If the recipient refuses tips, ask again without one. If the nonprofit requires a mailing address, this checkout cannot take the gift.
4. Collect the donor's first name, last name, and email, then call \`donate\` with the unchanged quote token.
5. Give the donor the Stripe-hosted checkout link. Better Giving never receives card numbers.
6. Poll \`donation_status\` with the donation id until it is settled or expired. A declined card leaves Checkout open. \`expired\` means it lapsed. Call \`donate\` again with the same quote token to open a new Checkout, until the quote itself expires (one hour); then request a new quote.

Send \`Authorization: Bearer\` with the agent token when you have one. The hourly cap is per token, and otherwise per trusted client address.

Repeated \`donate\` calls with the same quote token and an open Checkout return that Checkout and do not create another charge. Quote tokens are signed: send them back unchanged.
`;

const tools = [
  {
    name: "find_nonprofit",
    description:
      "Find a Better Giving nonprofit by name or US EIN. items lists only listed nonprofits whose name matches the query, best first; match is exact when one is the name asked for, close when only similar names match (confirm with the donor), and none when no listed nonprofit matches. Each listed item carries increments: the nonprofit's preset amounts in USD, smallest first, each with a label in the nonprofit's own words. Offer them as the amount options, plus a custom amount; an increment with an empty label is offered as the amount alone. Offer generic amounts plus a custom amount only when increments is empty, and never invent what an amount achieves. IRS-verified 501(c)(3)s that are not on Better Giving come back in not_on_better_giving and cannot take a donation: tell the donor and share onboarding_url, and never pass them to quote_donation. If external_lookup is invalid_query, ask for a name of at least two characters or a 9-digit EIN. If external_lookup is not ok, not_found, or invalid_query, the IRS lookup is temporarily unavailable.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, ein: { type: "string" } },
      anyOf: [{ required: ["query"] }, { required: ["ein"] }],
    },
  },
  {
    name: "quote_donation",
    description:
      "Quote a one-time USD donation, including tip and optional card-fee coverage. increment_label is the nonprofit's own label when amount exactly equals one of its increments and that label is not empty, otherwise null; repeat it as the nonprofit's words, never as a claim of your own. breakdown shows where the money goes: amount + tip + fee_allowance = total_charged, and nonprofit_receives + platform_fee (1.5% of the donation amount, or of each member's share for a fund, for each nonprofit that turned off tips, whether or not the card fee is covered) + fiscal_sponsor_fee (2.9% of the donation amount, or of each member's share for a fund, for a fiscally sponsored nonprofit, whether or not the card fee is covered) + processing_fee (Stripe's card fee, estimated at its card rate) + better_giving_receives (the tip and what the fee allowance leaves after the card fee) = total_charged.",
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

function jsonrpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpc_error(id: unknown, code: number, message: string, data?: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

async function call_tool(name: string, args: unknown, request: Request) {
  switch (name) {
    case "find_nonprofit":
      return find_nonprofit(args, request);
    case "quote_donation":
      return create_quote(args);
    case "donate":
      return donate(args, request);
    case "donation_status":
      return donation_status(args);
    default:
      throw new AgentDonationError("tool_not_found", `Unknown tool: ${name}`);
  }
}

export const loader: LoaderFunction = () =>
  new Response(GUIDE, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return rpc_error(null, -32700, "Parse error");
  }
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc_error(body?.id ?? null, -32600, "Invalid Request");
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }
  if (body.method === "ping") return jsonrpc(body.id, {});
  if (body.method === "initialize") {
    return jsonrpc(body.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "better-giving", version: "1.0.0" },
      instructions: GUIDE,
    });
  }
  if (body.method === "tools/list") return jsonrpc(body.id, { tools });
  if (body.method !== "tools/call") {
    return rpc_error(body.id, -32601, "Method not found");
  }

  try {
    const result = await call_tool(
      body.params?.name,
      body.params?.arguments ?? {},
      request
    );
    return jsonrpc(body.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    if (error instanceof AgentDonationError) {
      return jsonrpc(body.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: error.code,
              message: error.message,
            }),
          },
        ],
        structuredContent: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
};
