import type { ActionFunction } from "react-router";
import { type BaseIssue, getDotPath, object, safeParse } from "valibot";
import {
  donations_cookie,
  type IDonationIntentExpiries,
} from "#/.server/cookie";
import { to_fn } from "#/.server/donation-recipient";
import { to_from } from "@/donations/helpers";
import { intent as schema } from "@/donations/schema";
import { resp } from "@/helpers/https";
import { $req } from "@/schemas";
import { campaign_accepts, campaign_by_id } from "$/pg/queries/campaign";
import { form_get } from "$/pg/queries/form";
import { npo_program_get } from "$/pg/queries/program";
import { chariot_intent } from "./chariot";
import { crypto_intent } from "./crypto";
import { paypal_intent } from "./paypal";
import { capture_order } from "./paypal/capture-order";
import { stripe_intent } from "./stripe";
import type { Ctx, Provider } from "./types";

const providers = {
  card: stripe_intent,
  bank: stripe_intent,
  paypal: paypal_intent,
  crypto: crypto_intent,
  chariot: chariot_intent,
} satisfies Record<Ctx["via"], Provider>;

const capture_schema = object({ order_id: $req, don_id: $req });

const json_with_cookie_fn =
  (existing: null | IDonationIntentExpiries) =>
  async (data: Record<string, any>, key: string) => {
    const now = Date.now();
    const obj = existing || {};

    // remove expired keys
    for (const k of Object.keys(obj)) {
      if (obj[k] < now) {
        delete obj[k];
      }
    }

    obj[key] = now + 15 * 60 * 1000; // 15 minutes

    // keep only top 5 most recent keys
    const sorted_entries = Object.entries(obj)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const expiry_per_id = Object.fromEntries(sorted_entries);

    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "set-cookie": await donations_cookie.serialize(expiry_per_id),
      },
    });
  };

// every checkout shows this body via `json_ok`, which surfaces it for the
// refusal header `resp.refuse` sets. the detail stays in the log
const refused = (detail: string) => {
  console.info(`[resp] 400 - ${detail}`);
  return resp.refuse(
    "We couldn't process this donation. Please refresh the page and try again."
  );
};

const refused_issue = ([i]: [BaseIssue<unknown>, ...BaseIssue<unknown>[]]) =>
  refused(`${getDotPath(i)}: ${i.message}`);

// json can't encode `undefined`, so it marks a body that didn't parse
const json_body = (request: Request): Promise<unknown> =>
  request.json().catch(() => undefined);

export const action: ActionFunction = async ({ request }) => {
  // server-side paypal capture
  if (request.method === "PATCH") {
    const body = await json_body(request);
    if (body === undefined) return refused("body is not json");
    const parsed = safeParse(capture_schema, body);
    if (parsed.issues) return refused_issue(parsed.issues);
    const capture = await capture_order(parsed.output);
    return Response.json(capture);
  }

  const expiry_per_intent: IDonationIntentExpiries | null =
    await donations_cookie.parse(request.headers.get("cookie"));

  const body = await json_body(request);
  if (body === undefined) return refused("body is not json");
  const parsed = safeParse(schema, body);
  if (parsed.issues) return refused_issue(parsed.issues);
  const {
    to_id,
    via,
    via_extra,
    donor,
    program,
    form_id,
    campaign_id: requested_campaign,
    ...rest
  } = parsed.output;

  // the chariot row is stored at upusd 1, which is only true of usd
  if (via === "chariot" && rest.currency !== "USD") {
    return refused(`chariot is usd-only, got ${rest.currency}`);
  }

  const to = await to_fn(to_id, { open_at: new Date() });
  if (!to) {
    const recipient = typeof to_id === "number" ? "nonprofit" : "campaign";
    console.info(`[resp] 404 - ${recipient}:${to_id} not found or closed`);
    return resp.refuse(
      `This ${recipient} isn't accepting donations right now.`,
      404
    );
  }
  const from = to_from(donor);

  // a campaign this nonprofit does not own is dropped and the gift is unattributed.
  // one it owns that is not live, or is past its end, is refused.
  let campaign_id: string | undefined;
  let program_req = program;
  if (requested_campaign) {
    const campaign = await campaign_by_id(requested_campaign);
    const owned =
      campaign && typeof to_id === "number" && campaign.owner_npo_id === to_id;
    if (!owned) {
      campaign_id = undefined;
    } else if (!campaign_accepts(campaign, new Date())) {
      return resp.refuse("This campaign isn't accepting donations right now.");
    } else {
      campaign_id = campaign.id;
      program_req = campaign.program_id
        ? { id: campaign.program_id, name: campaign.program_name ?? "" }
        : undefined;
    }
  }

  // settlement credits intent.program and the form's running total; a program
  // the recipient npo doesn't own, or a form raising for another recipient, is
  // dropped so the gift still goes through, just unattributed
  const [prog, form] = await Promise.all([
    program_req && typeof to_id === "number"
      ? npo_program_get(program_req.id, to_id)
      : undefined,
    form_id ? form_get(form_id) : undefined,
  ]);
  const form_to = form && (form.recipient_fund_id ?? form.recipient_npo_id);
  const intent = {
    ...rest,
    ...(campaign_id && { campaign_id }),
    ...(form_to === to_id && { form_id }),
    ...(prog && { program: { id: prog.id, name: prog.title } }),
  };

  const ctx: Ctx = { to, from, donor, via, via_extra, intent };
  const result = await providers[via](ctx);
  if (result instanceof Response) return result;

  const json_with_cookie = json_with_cookie_fn(expiry_per_intent);
  return await json_with_cookie(result.body, result.don_id);
};
