import * as v from "valibot";
import { $, $req } from "@/schemas";

export const METHODS = [
  "card",
  "ach",
  "apple_pay",
  "google_pay",
  "paypal",
  "venmo",
  "daf",
  "crypto",
] as const;
export type Method = (typeof METHODS)[number];

const minor = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const named = v.object({ id: $req, name: $ });

const origin = v.pipe($req, v.url());

/** `POST /payments`, as the contract names it. a field the contract doesn't
 * name is ignored: additions stay inside v1 */
export const payment_request = v.object({
  gift_id: v.pipe($req, v.maxLength(200)),
  amount: v.object({
    gift: minor,
    gift_fee_cover: minor,
    contribution: minor,
    contribution_fee_cover: minor,
  }),
  // upper-cased by the route: the wire schema cannot express a transform
  currency: $req,
  method: v.picklist(METHODS),
  coin: v.optional($req),
  contribution_offered: v.boolean(),
  deployment_origin: origin,
  page_origin: v.optional(origin),
  donor_ip: v.optional($req),
  donor: v.object({
    email: v.pipe($req, v.email("Check the email for correctness")),
    first_name: v.optional($),
    last_name: v.optional($),
  }),
  tribute: v.optional(
    v.object({
      kind: v.picklist(["honor", "memory"]),
      honoree: $req,
      notify: v.optional(
        v.object({ name: $req, email: v.pipe($req, v.email()) })
      ),
    })
  ),
  form: named,
  campaign: v.optional(named),
  program: v.optional(named),
  authorized_session_id: v.optional($req),
});

export type PaymentRequest = v.InferOutput<typeof payment_request>;
