import { createHash } from "node:crypto";
import { ChariotError } from "@better-giving/chariot";
import { PayPalApiError } from "@better-giving/paypal";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import Stripe from "stripe";
import { limit_shared, type Quota } from "#/.server/auth/rate-limit";
import { to_fn } from "#/.server/donation-recipient";
import { report_error } from "#/errors/report";
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
import { paypal } from "../kit/paypal";
import type { Db } from "../pg/db";
import { is_unique_violation } from "../pg/errors";
import { donation_tribute_upsert } from "../pg/queries/donation";
import { donations } from "../pg/schema/donation";
import {
  type IPartnerAmount,
  type IPartnerAttribution,
  type IPartnerPaymentAnswer,
  type IPartnerProviderState,
  partner_payments,
} from "../pg/schema/partner";
import type { Method, PaymentRequest } from "./payment-schema";
import {
  below_minimum,
  problem,
  provider_error,
  rate_limited,
} from "./problem";
import { readiness } from "./readiness";

/** per donor address, so one donor can't spend a site's whole key quota */
export const DONOR_IP_QUOTA: Quota = { max: 20, window_s: 60 };

/** a claim with no session after this long belongs to a request that died */
const CLAIM_STALE_MS = 2 * 60 * 1000;

/** the checkout rail each method rides: wallets are card payments, venmo is
 * paypal's, a DAF gift rides chariot. `crypto` has no rail here */
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
      // a repeat names the same donor, and the same authorization on a DAF
      r.donor.email.toLowerCase(),
      r.method === "daf" ? r.authorized_session_id : null,
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

/** a PayPal order the donor has had for over an hour that PayPal has since
 * voided. any other answer, or a lookup that fails, leaves the order as is: an
 * order still open may yet be approved */
const ORDER_CHECK_AFTER_MS = 60 * 60 * 1000;

async function order_voided(
  db: Db,
  answer: IPartnerPaymentAnswer,
  created_at: string | Date
): Promise<boolean> {
  if (answer.client.provider !== "paypal") return false;
  if (Date.now() - new Date(created_at).getTime() < ORDER_CHECK_AFTER_MS) {
    return false;
  }
  // paypal is asked only about an order that could still be paid
  const [don] = await db
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, answer.id));
  if (!don || !["created", "intent"].includes(don.status)) return false;
  const order = await paypal
    .get_order(answer.client.token)
    // a 404 is an order paypal no longer has: it expired unapproved
    .catch((err) =>
      err instanceof PayPalApiError && err.http_status === 404 ? "gone" : null
    );
  if (order === "gone") return true;
  // an order still `CREATED` may yet be approved, whatever its age: only
  // paypal's own word that it is void releases the gift id
  return order !== null && order.status === "VOIDED";
}

/** joins a replaced payment's gift id to its payment id in the renamed row */
const SUPERSEDED = "#superseded#";

const send = (answer: IPartnerPaymentAnswer) =>
  resp.json(answer, 200, { "cache-control": "no-store" });

/** the same request is being made right now, or lost its claim to a retry: not
 * a conflict, so a 503 the site retries as it would any provider answer */
const RETRY_AFTER_S = CLAIM_STALE_MS / 1000;
/** for a failure whose claim is already released: the retry can go at once */
const SHORT_RETRY_AFTER_S = 5;
const still_being_made = () =>
  provider_error(
    503,
    "This gift_id is still being created. Retry the same request.",
    RETRY_AFTER_S
  );

type Claim =
  | {
      kind: "mine";
      /** names this request's hold on the gift id: a takeover changes it, so
       * a request that lost the claim can't release or write the winner's row */
      claim_id: string;
      /** a DAF payment's id, minted before its grant so a retry of a request
       * that died after making the grant finds the same donation */
      donation_id: string | null;
      /** what an earlier attempt of this payment chose with its processor */
      provider_state: IPartnerProviderState | null;
    }
  | { kind: "replay"; answer: IPartnerPaymentAnswer }
  | { kind: "refused"; response: Response };

/** takes the gift id for this request, or says what already holds it. the row
 * is written before any session exists, so two requests for one gift can't
 * both make one */
async function claim(
  db: Db,
  npo_id: number,
  req: PaymentRequest,
  fingerprint: string,
  again = false
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
  let mine:
    | {
        claim_id: string;
        donation_id: string | null;
        provider_state: IPartnerProviderState | null;
      }
    | undefined;
  try {
    [mine] = await db
      .insert(partner_payments)
      .values({
        npo_id,
        gift_id: req.gift_id,
        fingerprint,
        method: req.method,
        currency: req.currency,
        amount: req.amount,
        attribution,
        claim_id: crypto.randomUUID(),
        // minted here so a retry of a request that died finds its own
        // donation and processor objects
        donation_id: crypto.randomUUID(),
        authorized_session_id:
          req.method === "daf" ? req.authorized_session_id : undefined,
      })
      // the primary key only: any other conflict is not a repeat
      .onConflictDoNothing({
        target: [partner_payments.npo_id, partner_payments.gift_id],
      })
      .returning({
        claim_id: partner_payments.claim_id,
        donation_id: partner_payments.donation_id,
        provider_state: partner_payments.provider_state,
      });
  } catch (err) {
    if (!is_unique_violation(err, "partner_payments_session_id_idx")) throw err;
    // the same request racing itself also lands here: once more, so its
    // winner's row answers it, before the authorization is called used
    if (!again) return claim(db, npo_id, req, fingerprint, true);
    // a payment that isn't recorded yet may have made no grant at all (its
    // request failed or is still running). once its claim is stale the
    // authorization passes to this gift, which finds the grant if there is one
    // and keeps the donation the first attempt wrote
    const moved = await takeover_by_session(db, npo_id, req, fingerprint);
    if (moved) return moved;
    return {
      kind: "refused",
      response: problem("invalid_request", {
        errors: [
          {
            path: "authorized_session_id",
            message: "This authorization already made a payment.",
          },
        ],
      }),
    };
  }
  if (mine) return { kind: "mine", ...mine };

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
  // released between the insert and this read: the caller goes again, once
  if (!held) {
    if (!again) return claim(db, npo_id, req, fingerprint, true);
    return {
      kind: "refused",
      response: still_being_made(),
    };
  }
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

  // the same request, still being made, or its maker died. a stale claim is
  // taken over by one request only: the update names the claim it saw
  const [taken] = await db
    .update(partner_payments)
    .set({ claimed_at: sql`now()`, claim_id: crypto.randomUUID() })
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
    .returning({
      claim_id: partner_payments.claim_id,
      donation_id: partner_payments.donation_id,
      provider_state: partner_payments.provider_state,
    });
  if (taken) return { kind: "mine", ...taken };
  return {
    kind: "refused",
    response: still_being_made(),
  };
}

/** the authorization's stale, unrecorded holder (any gift id of this
 * nonprofit) becomes this gift: one statement, so one request wins. null when
 * the holder is recorded, or still young (the site is told to wait) */
async function takeover_by_session(
  db: Db,
  npo_id: number,
  req: PaymentRequest,
  fingerprint: string
): Promise<Claim | null> {
  const session = req.authorized_session_id ?? "";
  const [holder] = await db
    .select({
      response: partner_payments.response,
      fingerprint: partner_payments.fingerprint,
    })
    .from(partner_payments)
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.authorized_session_id, session)
      )
    );
  if (!holder || holder.response) return null;
  // the grant, and the donation row written for it, are the first gift's: a
  // gift that differs in amount, donor or method can't inherit them
  if (holder.fingerprint !== fingerprint) {
    return {
      kind: "refused",
      response: problem("idempotency_conflict", {
        detail:
          "This authorization was used with a different amount, donor or method.",
      }),
    };
  }
  try {
    const [taken] = await db
      .update(partner_payments)
      .set({
        gift_id: req.gift_id,
        fingerprint,
        method: req.method,
        currency: req.currency,
        amount: req.amount,
        claimed_at: sql`now()`,
        claim_id: crypto.randomUUID(),
      })
      .where(
        and(
          eq(partner_payments.npo_id, npo_id),
          eq(partner_payments.authorized_session_id, session),
          eq(partner_payments.fingerprint, fingerprint),
          isNull(partner_payments.response),
          lt(
            partner_payments.claimed_at,
            sql`now() - make_interval(secs => ${CLAIM_STALE_MS / 1000})`
          )
        )
      )
      .returning({
        claim_id: partner_payments.claim_id,
        donation_id: partner_payments.donation_id,
        provider_state: partner_payments.provider_state,
      });
    if (taken) return { kind: "mine", ...taken };
  } catch (err) {
    // the new gift id is already a row of its own
    if (!is_unique_violation(err, "partner_payments_npo_id_gift_id_pk")) {
      throw err;
    }
    return {
      kind: "refused",
      response: problem("idempotency_conflict", {
        detail: "This gift_id was already used with a different request.",
      }),
    };
  }
  return { kind: "refused", response: still_being_made() };
}

/** gives the gift id back, if this request still holds it. `donation_id` is
 * the unpaid row its failed session leaves: closed in the same transaction, so
 * a request that lost its claim never fails the row its successor is using */
const release = (
  db: Db,
  npo_id: number,
  gift_id: string,
  claim_id: string,
  donation_id?: string | null
) =>
  db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(partner_payments)
      .where(
        and(
          eq(partner_payments.npo_id, npo_id),
          eq(partner_payments.gift_id, gift_id),
          eq(partner_payments.claim_id, claim_id),
          isNull(partner_payments.response)
        )
      )
      .returning({ gift_id: partner_payments.gift_id });
    if (gone && donation_id) {
      await tx
        .update(donations)
        .set({ status: "failed" })
        .where(
          and(
            eq(donations.id, donation_id),
            inArray(donations.status, ["created", "intent"])
          )
        );
    }
  });

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

  // a repeat of a payment already made is answered from the record, ahead of
  // checks the nonprofit's settings may have changed since
  const fingerprint = fingerprint_of(req);
  const [held] = await db
    .select({
      fingerprint: partner_payments.fingerprint,
      response: partner_payments.response,
      created_at: partner_payments.created_at,
    })
    .from(partner_payments)
    .where(
      and(
        eq(partner_payments.npo_id, npo_id),
        eq(partner_payments.gift_id, req.gift_id)
      )
    );
  // a gift id already used for another request is a conflict whatever the
  // nonprofit's settings say now, so it is answered before any of them is read
  if (held && held.fingerprint !== fingerprint) {
    return problem("idempotency_conflict", {
      detail:
        "This gift_id was already used with a different amount, currency, method, donor or authorization.",
    });
  }
  let voided: IPartnerPaymentAnswer | null = null;
  if (held?.response) {
    if (!(await order_voided(db, held.response, held.created_at))) {
      return send(held.response);
    }
    voided = held.response;
  }

  // limited per donor address as well as per key, after a repeat is answered
  // free, and per nonprofit so one site's donors can't lock out another's
  if (req.donor_ip) {
    const limited = await charge_donor_ip(db, npo_id, req.donor_ip);
    if (limited) return limited;
  }

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

  // the donor can no longer approve the order the repeat names: the gift id
  // gets a new one, and the old donation is closed, after every check above
  // has passed so a refusal leaves the old payment as it was
  if (voided) {
    // the close and the rename happen only if the donation is still unpaid: one
    // paid meanwhile keeps its answer, and one a racing repeat just closed
    // leaves the new answer to the claim
    const closed = await db.transaction(async (tx) => {
      const [expired] = await tx
        .update(donations)
        .set({ status: "expired" })
        .where(
          and(
            eq(donations.id, voided.id),
            inArray(donations.status, ["created", "intent"])
          )
        )
        .returning({ id: donations.id });
      if (!expired) {
        const [now] = await tx
          .select({ status: donations.status })
          .from(donations)
          .where(eq(donations.id, voided.id));
        return now?.status === "expired" ? "raced" : false;
      }
      // the row stays, under a gift id of its own, so the old payment id still
      // reads (as cancelled) and a failure after this loses nothing
      await tx
        .update(partner_payments)
        .set({
          gift_id: `${req.gift_id}${SUPERSEDED}${voided.id}`,
          superseded_at: sql`now()`,
        })
        .where(
          and(
            eq(partner_payments.npo_id, npo_id),
            eq(partner_payments.gift_id, req.gift_id),
            eq(partner_payments.donation_id, voided.id)
          )
        );
      return true;
    });
    if (closed === false) return send(voided);
  }

  const claimed = await claim(db, npo_id, req, fingerprint);
  if (claimed.kind === "replay") return send(claimed.answer);
  if (claimed.kind === "refused") return claimed.response;
  const hold = claimed;

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
    ...(hold.donation_id && { don_id: hold.donation_id }),
    ...(via === "chariot" &&
      req.tribute && { tribute: to_ctx_tribute(req.tribute) }),
    // the partner's intents take cards only: the wallets are cards, and the
    // other payment methods readiness would refuse must not confirm
    ...(via === "card" && { card_only: true }),
    ...(via === "card" || via === "bank"
      ? {
          provider_state: hold.provider_state ?? undefined,
          on_provider_state: async (state: IPartnerProviderState) => {
            await db
              .update(partner_payments)
              .set({ provider_state: state })
              .where(
                and(
                  eq(partner_payments.npo_id, npo_id),
                  eq(partner_payments.gift_id, req.gift_id),
                  eq(partner_payments.claim_id, hold.claim_id)
                )
              );
          },
        }
      : {}),
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
    // an error that may have left a made object (a grant, an order, an intent)
    // keeps the claim, so a retry after the stale window takes it over under
    // the same minted id and keys and finds that object. a definite refusal
    // gives the gift id back and closes its unpaid row. an error that isn't a
    // processor's is unknown on the DAF rail (a grant may exist) and released
    // elsewhere
    const failure = provider_failure(err);
    const keep = failure ? failure.keep_claim : via === "chariot";
    if (!keep) {
      await release(
        db,
        npo_id,
        req.gift_id,
        hold.claim_id,
        hold.donation_id
      ).catch((e) => report_error(e, { where: "partner release" }));
    }
    if (failure) return failure.response;
    throw err;
  }
  if (is_refusal(made)) {
    await release(db, npo_id, req.gift_id, hold.claim_id, hold.donation_id);
    return refusal_response(made);
  }

  const answer = answer_of(method, made);
  // the tribute notice goes out with the receipt, from the donation's tribute
  // row, as it does for a checkout gift
  // (a DAF gift's goes in with its row, ahead of the grant, which can settle
  // before this point)
  if (req.tribute && via !== "chariot") {
    await write_tribute(db, answer.id, req.tribute);
  }
  // the intent route records the grant it made as the row's `via_extra`
  const [granted] =
    via === "chariot"
      ? await db
          .select({ via_extra: donations.via_extra })
          .from(donations)
          .where(eq(donations.id, answer.id))
      : [];
  let recorded: unknown[];
  try {
    recorded = await db
      .update(partner_payments)
      .set({
        donation_id: answer.id,
        response: answer,
        ...(granted?.via_extra && { grant_id: granted.via_extra }),
      })
      .where(
        and(
          eq(partner_payments.npo_id, npo_id),
          eq(partner_payments.gift_id, req.gift_id),
          eq(partner_payments.claim_id, hold.claim_id),
          isNull(partner_payments.response)
        )
      )
      .returning({ gift_id: partner_payments.gift_id });
  } catch (err) {
    if (!is_unique_violation(err, "partner_payments_grant_id_idx")) throw err;
    // a second gift on an authorization that already made a payment: its
    // grant settles the first. the row just made can never be paid
    await db
      .update(donations)
      .set({ status: "failed" })
      .where(eq(donations.id, answer.id));
    await release(db, npo_id, req.gift_id, hold.claim_id);
    return problem("invalid_request", {
      errors: [
        {
          path: "authorized_session_id",
          message: "This authorization already made a payment.",
        },
      ],
    });
  }
  // the claim went to a later request while this one ran: its row is its own,
  // and this session is never recorded
  if (recorded.length === 0) {
    return still_being_made();
  }
  return send(answer);
}

const to_ctx_tribute = (
  t: NonNullable<PaymentRequest["tribute"]>
): NonNullable<Ctx["tribute"]> => ({
  full_name: t.honoree,
  ...(t.notify && {
    notif: {
      to_email: t.notify.email,
      to_fullname: t.notify.name,
      from_msg: "",
    },
  }),
});

async function write_tribute(
  db: Db,
  donation_id: string,
  tribute: NonNullable<PaymentRequest["tribute"]>
) {
  await donation_tribute_upsert(db, {
    donation_id,
    name: tribute.honoree,
    notif_email: tribute.notify?.email ?? null,
    notif_fullname: tribute.notify?.name ?? null,
    notif_msg: null,
  });
}

function is_unknown_outcome(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  if (
    err instanceof TypeError &&
    /fetch failed|terminated/i.test(err.message)
  ) {
    return true;
  }
  const cause =
    err instanceof Error
      ? (err.cause as { code?: string } | undefined)
      : undefined;
  return (
    cause?.code !== undefined &&
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(
      cause.code
    )
  );
}

/** what a processor's own failure becomes: 503 where trying again can help (a
 * timeout, a 5xx, a rate limit, a request still being made), 502 where it
 * refused, which is also ours to look at (a key, a permission, our own
 * params). `keep_claim` is true when the outcome may be a made object, so a
 * retry must find it under the same ids. null: not a processor's error */
function provider_failure(
  err: unknown
): { response: Response; keep_claim: boolean } | null {
  const retry = (detail: string) => ({
    response: provider_error(503, detail, RETRY_AFTER_S),
    keep_claim: true,
  });
  const refused = (who: string) => {
    report_error(err, { where: "partner", provider: who });
    return {
      response: provider_error(502, `${who} refused this request.`),
      keep_claim: false,
    };
  };
  if (err instanceof ChariotError) {
    return err.http_status === 409 ||
      err.http_status === 429 ||
      err.http_status >= 500
      ? retry(
          "The DAF provider is still working on this authorization. Retry the same request."
        )
      : refused("The DAF provider");
  }
  if (err instanceof PayPalApiError) {
    return err.http_status === 429 || err.http_status >= 500
      ? retry("PayPal is not answering. Retry the same request.")
      : refused("PayPal");
  }
  if (err instanceof Stripe.errors.StripeError) {
    const t = err.type;
    // stripe stores a 5xx under the idempotency key and replays it for a day,
    // so a retry under the same key would answer the same failure. the claim
    // is released: the retry gets a new payment id and new keys, at worst
    // leaving an unused intent or customer. only a real 5xx: the SDK also
    // raises this class for a 409 (the key is in use by a request still
    // running) and for an unreadable body, where the request may have run, so
    // those keep the claim and its keys, as do a dropped connection (which can
    // come after stripe processed the request) and a rate limit
    if (t === "StripeAPIError" && (err.statusCode ?? 0) >= 500) {
      return {
        response: provider_error(
          503,
          "Stripe could not complete this request. Retry the same request.",
          SHORT_RETRY_AFTER_S
        ),
        keep_claim: false,
      };
    }
    return t === "StripeAPIError" ||
      t === "StripeConnectionError" ||
      t === "StripeRateLimitError"
      ? retry("Stripe is not answering. Retry the same request.")
      : // a key reused with other params is ours to fix, not Stripe's to retry
        refused("Stripe");
  }
  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return retry("The payment provider timed out. Retry the same request.");
  }
  // a dropped connection or a reply that can't be read (fetch's `TypeError`,
  // a `SyntaxError` from the body): the request may have run, so the claim
  // stays and a retry finds the same order or grant under the same ids
  if (is_unknown_outcome(err)) {
    // a lasting cause (a wrong api url, a tls failure) would loop here with
    // every request answered 503, so each is reported
    report_error(err, { where: "partner", provider: "lost answer" });
    return retry(
      "The payment provider's answer was lost. Retry the same request."
    );
  }
  return null;
}

/** one charge against the donor address's bucket, null when it had room */
async function charge_donor_ip(
  db: Db,
  npo_id: number,
  donor_ip: string
): Promise<Response | null> {
  const r = await limit_shared(
    `partner:donor_ip:${npo_id}:${sha256(donor_ip)}`,
    DONOR_IP_QUOTA,
    db
  );
  return r.ok ? null : rate_limited(r.retry_after_s);
}

const PAID = new Set(["settled", "refunded", "refunded_loss"]);

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
      superseded_at: partner_payments.superseded_at,
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
      // a replaced payment's row carries its gift id and its own id joined
      gift_id: row.superseded_at
        ? row.gift_id.slice(0, row.gift_id.lastIndexOf(SUPERSEDED))
        : row.gift_id,
      // a replaced order is cancelled, unless the donor paid it anyway: money
      // moved wins over the tombstone
      status:
        row.superseded_at && !PAID.has(row.status)
          ? "cancelled"
          : (STATUS[row.status as keyof typeof STATUS] ?? "pending"),
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
