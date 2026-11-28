import { createHash } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { limit_shared, type Quota } from "#/.server/auth/rate-limit";
import { to_fn } from "#/.server/donation-recipient";
import { chariot_create } from "#/routes/api.donation-intents/chariot";
import { paypal_create } from "#/routes/api.donation-intents/paypal";
import { stripe_create } from "#/routes/api.donation-intents/stripe";
import type { Ctx, IntentResult } from "#/routes/api.donation-intents/types";
import { MIN_DONATION_USD } from "@/constants/common";
import { to_from } from "@/donations/helpers";
import { resp } from "@/helpers/https";
import {
  currency_refusal,
  is_refusal,
  type Refusal,
} from "../donation-intents/refusal";
import type { Db } from "../pg/db";
import { donations } from "../pg/schema/donation";
import {
  type IPartnerAmount,
  type IPartnerAttribution,
  type IPartnerPaymentAnswer,
  partner_payments,
} from "../pg/schema/partner";
import type { Method, PaymentRequest } from "./payment-schema";
import { below_minimum, problem, rate_limited } from "./problem";
import { readiness } from "./readiness";

/** per donor address, so one donor can't spend a site's whole key quota */
export const DONOR_IP_QUOTA: Quota = { max: 20, window_s: 60 };

/** a claim with no session after this long belongs to a request that died */
const CLAIM_STALE_MS = 2 * 60 * 1000;

/** the checkout rail each method rides: wallets are card payments, venmo is
 * paypal's. `daf` and `crypto` have no card-style intent here */
const VIA: Record<Exclude<Method, "crypto">, Ctx["via"]> = {
  card: "card",
  apple_pay: "card",
  google_pay: "card",
  ach: "bank",
  paypal: "paypal",
  venmo: "paypal",
  daf: "chariot",
};

const sha256 = (x: string) => createHash("sha256").update(x).digest("hex");

/** what a repeat of a gift must match */
export const fingerprint_of = (r: PaymentRequest): string =>
  sha256(
    JSON.stringify([
      r.method,
      r.currency,
      r.amount.gift,
      r.amount.gift_fee_cover,
      r.amount.contribution,
      r.amount.contribution_fee_cover,
    ])
  );

/** checkout's lines in major units: the gift is `base`, the contribution is
 * the tip, and both fee covers are the fee allowance. usd only, so a cent is
 * a hundredth */
export const to_checkout_amount = (a: IPartnerAmount) => ({
  base: a.gift / 100,
  tip: a.contribution / 100,
  fee_allowance: (a.gift_fee_cover + a.contribution_fee_cover) / 100,
});

/** the smallest gift in the request's currency, in minor units */
const minimum_minor = (r: Refusal): number =>
  Math.ceil((r.minimum_usd ?? MIN_DONATION_USD) * (r.upusd ?? 1) * 100);

const refusal_response = (r: Refusal): Response => {
  switch (r.kind) {
    case "below_minimum":
      return below_minimum(minimum_minor(r), r.copy);
    case "above_maximum":
      return problem("above_maximum", { detail: r.copy });
    case "unsupported":
      return problem("unsupported", { detail: r.copy });
    case "authorization_expired":
      return problem("authorization_expired", { detail: r.copy });
    case "invalid":
      return problem("invalid_request", { detail: r.copy });
  }
};

const answer_of = (
  method: Method,
  result: IntentResult
): IPartnerPaymentAnswer => {
  const b = result.body;
  switch (VIA[method as Exclude<Method, "crypto">]) {
    case "chariot":
      return {
        id: result.don_id,
        client: { provider: "chariot", token: result.don_id },
      };
    case "paypal":
      return {
        id: result.don_id,
        client: { provider: "paypal", token: String(b.tx_id) },
      };
    default:
      return {
        id: result.don_id,
        client: { provider: "stripe", token: String(b.client_secret) },
      };
  }
};

const send = (answer: IPartnerPaymentAnswer) =>
  resp.json(answer, 200, { "cache-control": "no-store" });

type Claim =
  | { kind: "mine" }
  | { kind: "replay"; answer: IPartnerPaymentAnswer }
  | { kind: "refused"; response: Response };

/** takes the gift id for this request, or says what already holds it. the row
 * is written before any session exists, so two requests for one gift can't
 * both make one */
async function claim(
  db: Db,
  npo_id: number,
  req: PaymentRequest,
  fingerprint: string
): Promise<Claim> {
  const attribution: IPartnerAttribution = {
    form: req.form,
    ...(req.campaign && { campaign: req.campaign }),
    ...(req.program && { program: req.program }),
    ...(req.tribute && { tribute: req.tribute }),
    contribution_offered: req.contribution_offered,
    deployment_origin: req.deployment_origin,
    ...(req.page_origin && { page_origin: req.page_origin }),
  };
  const [mine] = await db
    .insert(partner_payments)
    .values({
      npo_id,
      gift_id: req.gift_id,
      fingerprint,
      method: req.method,
      currency: req.currency,
      amount: req.amount,
      attribution,
    })
    .onConflictDoNothing()
    .returning({ gift_id: partner_payments.gift_id });
  if (mine) return { kind: "mine" };

  const [held] = await db
    .select({
      fingerprint: partner_payments.fingerprint,
      response: partner_payments.response,
    })
    .from(partner_payments)
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.gift_id, req.gift_id)
      )
    );
  // released between the insert and this read: the caller may go again
  if (!held) return claim(db, npo_id, req, fingerprint);
  if (held.fingerprint !== fingerprint) {
    return {
      kind: "refused",
      response: problem("idempotency_conflict", {
        detail:
          "This gift_id was already used with another amount, currency or method.",
      }),
    };
  }
  if (held.response) return { kind: "replay", answer: held.response };

  // the same request, still being made — or its maker died. a stale claim is
  // taken over by one request only: the update names the claim it saw
  const [taken] = await db
    .update(partner_payments)
    .set({ claimed_at: sql`now()` })
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.gift_id, req.gift_id),
        isNull(partner_payments.response),
        lt(
          partner_payments.claimed_at,
          sql`now() - make_interval(secs => ${CLAIM_STALE_MS / 1000})`
        )
      )
    )
    .returning({ gift_id: partner_payments.gift_id });
  if (taken) return { kind: "mine" };
  return {
    kind: "refused",
    response: problem("idempotency_conflict", {
      detail: "This gift_id is still being created. Retry the same request.",
    }),
  };
}

const release = (db: Db, npo_id: number, gift_id: string) =>
  db
    .delete(partner_payments)
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.gift_id, gift_id),
        isNull(partner_payments.response)
      )
    );

/** `POST /payments`: the same checks checkout runs, against the key's own
 * nonprofit, then one session on Better Giving's account for the method. a
 * request the checks refuse leaves no claim, so the gift id stays free */
export async function create_payment(
  db: Db,
  npo_id: number,
  input: PaymentRequest
): Promise<Response> {
  const req = { ...input, currency: input.currency.toUpperCase() };
  if (req.method === "crypto") {
    return problem("unsupported", {
      detail: "Crypto payments are not available yet.",
    });
  }
  const method = req.method;

  const ready = await readiness(db, npo_id);
  if (!ready.currencies.includes(req.currency)) {
    return problem("unsupported", {
      detail: `${req.currency} is not accepted.`,
    });
  }
  if (!ready.rails[method].offered) {
    return problem("unsupported", {
      detail: `${method} is not offered for this nonprofit.`,
    });
  }
  // the form's record decides whether a contribution can exist at all
  if (!req.contribution_offered && req.amount.contribution > 0) {
    return problem("invalid_request", {
      errors: [
        {
          path: "amount.contribution",
          message: "The form did not offer a contribution.",
        },
      ],
    });
  }
  if (method === "daf" && !req.authorized_session_id) {
    return problem("invalid_request", {
      errors: [
        {
          path: "authorized_session_id",
          message: "Required for a DAF payment.",
        },
      ],
    });
  }

  const via = VIA[method];
  const wrong_currency = currency_refusal(via, req.currency);
  if (wrong_currency) return refusal_response(wrong_currency);

  const to = await to_fn(npo_id, { open_at: new Date() });
  if (!to) {
    return problem("unsupported", {
      detail: "This nonprofit isn't accepting donations right now.",
    });
  }

  const fingerprint = fingerprint_of(req);
  const claimed = await claim(db, npo_id, req, fingerprint);
  if (claimed.kind === "replay") return send(claimed.answer);
  if (claimed.kind === "refused") return claimed.response;

  const donor = {
    email: req.donor.email.toLowerCase(),
    first_name: req.donor.first_name,
    last_name: req.donor.last_name,
  };
  const ctx: Ctx = {
    to,
    from: to_from(donor),
    donor,
    via,
    via_extra: method === "venmo" ? "venmo" : (req.authorized_session_id ?? ""),
    ...(via === "chariot" && { don_id: crypto.randomUUID() }),
    intent: {
      amount: to_checkout_amount(req.amount),
      currency: req.currency,
      source: "partner-api",
      frequency: "one-time",
    },
  };

  let made: Refusal | IntentResult;
  try {
    made =
      via === "chariot"
        ? await chariot_create(ctx)
        : via === "paypal"
          ? await paypal_create(ctx)
          : await stripe_create(ctx);
  } catch (err) {
    await release(db, npo_id, req.gift_id).catch(() => {});
    throw err;
  }
  if (is_refusal(made)) {
    await release(db, npo_id, req.gift_id);
    return refusal_response(made);
  }

  const answer = answer_of(method, made);
  await db
    .update(partner_payments)
    .set({ donation_id: answer.id, response: answer })
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.gift_id, req.gift_id)
      )
    );
  return send(answer);
}

/** one charge against the donor address's bucket, null when it had room */
export async function charge_donor_ip(
  db: Db,
  donor_ip: string
): Promise<Response | null> {
  const r = await limit_shared(
    `partner:donor_ip:${sha256(donor_ip)}`,
    DONOR_IP_QUOTA,
    db
  );
  return r.ok ? null : rate_limited(r.retry_after_s);
}

const STATUS = {
  created: "pending",
  intent: "pending",
  confirmed: "pending",
  settled: "succeeded",
  refunded: "succeeded",
  refunded_loss: "succeeded",
  failed: "failed",
  expired: "cancelled",
  cancelled: "cancelled",
} as const;

/** `GET /payments/{id}`: what the nonprofit's own payment holds now. a read of
 * our rows only: a capture is the processor event's, never this call's */
export async function read_payment(
  db: Db,
  npo_id: number,
  id: string
): Promise<Response> {
  const [row] = await db
    .select({
      gift_id: partner_payments.gift_id,
      method: partner_payments.method,
      currency: partner_payments.currency,
      amount: partner_payments.amount,
      status: donations.status,
      occurred_at: donations.updated_at,
    })
    .from(partner_payments)
    .innerJoin(donations, eq(donations.id, partner_payments.donation_id))
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.donation_id, id)
      )
    );
  if (!row) return problem("not_found");
  return resp.json(
    {
      id,
      gift_id: row.gift_id,
      status: STATUS[row.status as keyof typeof STATUS] ?? "pending",
      method: row.method,
      amount: row.amount,
      currency: row.currency,
      fee: null,
      occurred_at: new Date(row.occurred_at).toISOString(),
    },
    200,
    { "cache-control": "no-store" }
  );
}
