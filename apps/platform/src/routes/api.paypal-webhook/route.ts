import crypto from "node:crypto";
import { crc32 } from "node:zlib";
import {
  type Capture,
  type Order,
  PayPalApiError,
  type Sale,
  type Subs,
  type WebhookEvent,
} from "@better-giving/paypal";
import { report_degraded, report_error, report_resp } from "#/errors/report";
import {
  calc_donation_settle,
  type IDonation,
  type IDonationSettled,
  type IDonationUpdate,
  is_reversed,
  settle_msgs,
} from "@/donations";
import { paypal_donor_update } from "@/donations/helpers";
import { PLACEHOLDER_EMAIL } from "@/donations/schema";
import { msg } from "@/queue";
import type { Alert, Field } from "@/slack";
import type { ISub, TInterval, TStatus } from "@/subscriptions";
import { paypal as paypal_env, stage } from "$/env";
import { paypal } from "$/kit/paypal";
import { enqueue, schedule } from "$/kit/queue";
import { db } from "$/pg/db";
import { dispute_close, dispute_get } from "$/pg/queries/dispute";
import {
  donation_by_sttl_id,
  donation_get,
  donation_put,
  donation_settle_state_locked,
  donation_update,
  settlement_exists,
} from "$/pg/queries/donation";
import { type IOwed, owed_for_donation } from "$/pg/queries/owed";
import {
  sub_cancel_reason_default,
  sub_get,
  sub_put,
  sub_update,
} from "$/pg/queries/subscription";
import {
  alert_date,
  amount_label,
  donated_field,
  donor_field,
  owed_table,
  recipient_field,
  recipient_name,
  short_id,
} from "$/refund/alert";
import { dispute_opened, dispute_won } from "$/refund/dispute";
import {
  type ReversalSource,
  reverse_charge,
  type Share,
  WHOLE,
} from "$/refund/reverse";
import type { Route } from "./+types/route";

type TIntervalFrom = "DAY" | "WEEK" | "MONTH" | "YEAR";
const to_interval = (from: TIntervalFrom): TInterval => {
  switch (from) {
    case "DAY":
      return "day";
    case "WEEK":
      return "week";
    case "MONTH":
      return "month";
    case "YEAR":
      return "year";
  }
};

// builds an ISub from a paypal subscription resource + donation context, at
// the subscription's own status. returns a string naming what the subscription
// or its plan lacks, else the record; a plan lookup paypal refuses for good is
// `{ refused }`. both callers acknowledge either: ACTIVATED passes its event
// payload, which a redelivery repeats, and SALE passes the live subscription
// once it is past approval.
async function build_sub_record(args: {
  subs_id: string;
  sub: Subs;
  don: IDonation;
  from_email: string;
  create_time?: string;
  update_time?: string;
  /** stands in for next billing on a subscription that has ended or paused,
   * which paypal gives none — the column is not null */
  last_charge_time?: string;
}): Promise<ISub | string | { refused: number }> {
  const { subs_id, sub, don, from_email } = args;
  const create_time =
    args.create_time ?? sub.create_time ?? new Date().toISOString();
  const update_time =
    args.update_time ?? sub.update_time ?? new Date().toISOString();

  const plan_id = sub.plan_id;
  if (!plan_id) return "missing subscription plan id";
  const plan = await fetch_resource(() => paypal.get_plan(plan_id));
  if (typeof plan === "number") return { refused: plan };
  // any other non-2xx throws; a 2xx with no body is the fetch's fault, not
  // the payload's, so it throws to a redelivery rather than returning a gap
  if (!plan) throw new Error(`plan not found: ${sub.plan_id}`);
  const cycle = plan.billing_cycles?.[0];
  if (!cycle) return "missing plan billing cycle";
  const interval = cycle.frequency?.interval_unit;
  const interval_count = cycle.frequency?.interval_count || 1;
  if (!interval) return "missing plan frequency interval unit";
  const status = (sub.status && SUB_STATUS[sub.status]) || "active";
  const next_billing =
    sub.billing_info?.next_billing_time ??
    (status === "inactive" ? args.last_charge_time : undefined);
  if (!next_billing) return "missing next billing time";
  if (!plan.product_id) return "missing plan product id";

  const total = don.amount.base + don.amount.tip + don.amount.fee_allowance;
  const total_usd = total / don.upusd;
  return {
    id: subs_id,
    created_at: new Date(create_time).toISOString(),
    updated_at: new Date(update_time).toISOString(),
    interval: to_interval(interval),
    interval_count,
    next_billing: new Date(next_billing).toISOString(),
    amount: total,
    amount_usd: total_usd,
    currency: don.currency,
    product_id: plan.product_id,
    to_npo_id: don.to_type === "npo" ? Number(don.to_id) : null,
    to_fund_id: don.to_type === "fund" ? don.to_id : null,
    campaign_id: don.campaign_id ?? null,
    to_name: don.to_name,
    platform: "paypal",
    status,
    from_id: from_email,
  };
}

interface IAddress {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_1?: string;
  admin_area_2?: string;
  postal_code?: string;
  country_code: string;
}
interface IName {
  given_name?: string;
  surname?: string;
}

interface ISettlement {
  net: number;
  fee: number;
  c: string;
}

// paypal amounts are decimal strings; as floats 50 − 2.24 − 0.7 is
// 47.059999999999995, so this subtracts in the finest minor unit the operands use
const dec_sub = (from: string, parts: string[]): number => {
  const dp = Math.max(
    ...[from, ...parts].map((v) => v.split(".")[1]?.length ?? 0)
  );
  const k = 10 ** dp;
  const minor = (v: string) => Math.round(+v * k);
  return parts.reduce((acc, v) => acc - minor(v), minor(from)) / k;
};

// paypal hands the three parts separately at every call site — an order's
// payment source, a subscriber, a shipping address — so they are gathered here
// rather than at each one
const donor_update = (
  email: string,
  name: IName | undefined,
  address?: IAddress | undefined
): IDonationUpdate =>
  paypal_donor_update({ email_address: email, name, address });

/**
 * the enqueue sits after the commit, so a delivery can leave a settled row
 * whose messages never went out, or only some of them; the delivery whose
 * settle guard fires re-sends them all. a duplicate costs nothing — the dist is
 * absorbed by unique(donation_id, to_id), the match event by its unique
 * donation_id, the receipt by its send claim.
 *
 * a reversed row is the one case that must not be recomputed: the settle path
 * refuses to write over a refund, and re-queuing here would walk around that
 * with a dist and a receipt for money the donor already got back.
 */
const requeue = async (row: IDonation | undefined, order_id: string) => {
  if (!row?.settlement)
    throw new Error("duplicate settle without a settlement");
  if (is_reversed(row.status)) return;
  await enqueue(
    ...settle_msgs(
      { ...row, settlement: row.settlement },
      // the settlement living on the order row means this was the charge that
      // opened the donation; on any other row it is a rebill clone, which is
      // excluded from employer matching.
      { match: row.id === order_id }
    )
  );
};

/** 4xx that heal with no change to the event: a timeout or a rate limit */
const RETRYABLE_4XX = new Set([408, 429]);

/** a 4xx about the resource itself, answered the same way on every retry */
const is_refusal = (e: unknown): e is PayPalApiError =>
  e instanceof PayPalApiError &&
  e.http_status >= 400 &&
  e.http_status < 500 &&
  !RETRYABLE_4XX.has(e.http_status);

/**
 * `requeue` for a sale settled on an earlier delivery. the match flag needs the
 * order id, and only the subscription's custom_id carries it — nothing on the
 * settled row tells the order row from a rebill clone.
 *
 * a failed fetch throws through to a non-2xx: this redelivery is usually the
 * one recovering messages an earlier delivery never sent, and a 200 here would
 * stop paypal retrying with the dist still unsent. a missing subs id or
 * custom_id, or a 4xx on the lookup, is reported and answered 200 instead — no
 * retry can supply either.
 */
const requeue_sale = async (sale_id: string, subs_id: string | undefined) => {
  const sub = subs_id
    ? await paypal.get_subscription(subs_id).catch((e: unknown) => {
        if (!is_refusal(e)) throw e;
        report_error(
          new Error(
            `subscription lookup refused, sale ${sale_id} not requeued`,
            {
              cause: e,
            }
          ),
          { sale_id, subs_id, http_status: e.http_status }
        );
        return "refused" as const;
      })
    : undefined;
  if (sub === "refused") return;
  const order_id = sub?.custom_id;
  if (!order_id) {
    report_error(new Error(`no order id to requeue sale ${sale_id}`), {
      sale_id,
      subs_id,
    });
    return;
  }
  await requeue(await donation_by_sttl_id(sale_id), order_id);
};

// -- signature verification --

// paypal serves webhook certs from the classic `api.` host, not the `api-m.`
// one the rest client calls. an api url off this map leaves no cert host, so
// every delivery is answered 503 until the config is fixed
const CERT_HOST_BY_API_HOST: Record<string, string> = {
  "api-m.paypal.com": "api.paypal.com",
  "api.paypal.com": "api.paypal.com",
  "api-m.sandbox.paypal.com": "api.sandbox.paypal.com",
  "api.sandbox.paypal.com": "api.sandbox.paypal.com",
};
const paypal_api_host =
  paypal_env.api_url && URL.canParse(paypal_env.api_url)
    ? new URL(paypal_env.api_url).host
    : null;
const paypal_cert_host = paypal_api_host
  ? CERT_HOST_BY_API_HOST[paypal_api_host]
  : undefined;

/** the header names the key the signature is checked against, so a url
 * anywhere but paypal's lets the sender sign with a key of their own */
const is_paypal_cert_url = (url: URL) =>
  url.protocol === "https:" &&
  url.host === paypal_cert_host &&
  url.pathname.startsWith("/v1/notifications/certs/") &&
  !url.username &&
  !url.password &&
  !url.search &&
  !url.hash;

// the subject rule paypal's own java sdk applied (SSLUtil.validateCertificateChain):
// messageverificationcerts.paypal.com live, .sandbox.paypal.com in sandbox
const is_paypal_signing_cert = (cert: crypto.X509Certificate) =>
  cert.subject
    .split("\n")
    .some(
      (rdn) =>
        rdn.startsWith("CN=messageverificationcerts") &&
        rdn.endsWith(".paypal.com")
    );

const is_current = (cert: crypto.X509Certificate) => {
  const now = new Date();
  return cert.validFromDate <= now && now <= cert.validToDate;
};

const CERT_FETCH_TIMEOUT_MS = 5_000;

/** paypal's cert host is down or shedding load — a network error, a timeout, a
 * 5xx or a 429 — which heals with no change on either side. a 4xx, a redirect
 * or a 200 that isn't a cert does not, and is a plain Error */
class CertHostUnreachable extends Error {
  override name = "CertHostUnreachable";
}

const cert_cache = new Map<string, crypto.X509Certificate>();
/** throws on anything but paypal's current signing cert, caching only that */
async function download_and_cache_cert(
  cert_url: URL
): Promise<crypto.X509Certificate> {
  const cached = cert_cache.get(cert_url.href);
  if (cached && is_current(cached)) return cached;
  cert_cache.delete(cert_url.href);
  // the network failing or the timeout firing, while connecting or mid-body
  const unreachable = (cause: unknown) => {
    throw new CertHostUnreachable(
      `[paypal webhook] cert host ${cert_url.host} unreachable`,
      { cause }
    );
  };
  // the allowlist vetted this url only; a followed redirect would fetch the key
  // from wherever the hop points. "manual" hands the 3xx back as a status, so
  // the checks below report a redirect as a bug, not as the host being down
  const res = await fetch(cert_url, {
    redirect: "manual",
    signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS),
  }).catch(unreachable);
  // neither the Response nor an error with a `status` prop: the reporters keep
  // a 4xx of either out of sentry, and a 403/404 here drops every event
  const answered = `[paypal webhook] cert host ${cert_url.host} answered ${res.status}`;
  if (res.status >= 500 || res.status === 429)
    throw new CertHostUnreachable(answered);
  if (!res.ok) throw new Error(answered);
  const cert = new crypto.X509Certificate(await res.text().catch(unreachable));
  if (!is_paypal_signing_cert(cert))
    throw new Error("[paypal webhook] cert is not paypal's signing cert");
  if (!is_current(cert))
    throw new Error("[paypal webhook] paypal's signing cert is not current");
  cert_cache.set(cert_url.href, cert);
  return cert;
}

const UNVERIFIED_MAX_CHARS = 128;

/** which delivery a report is about. the signature failed or went unchecked,
 * so every field is the sender's say-so, and only the body's id and type are
 * read */
const delivery_ref = (
  body: string,
  transmission_id: string,
  cert_url: URL | null
) => {
  const ev = ((): { id?: unknown; event_type?: unknown } => {
    try {
      const v: unknown = JSON.parse(body);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  })();
  // a sender sets each to any length, and each lands in logs and sentry
  const clip = (v: unknown) =>
    typeof v === "string" ? v.slice(0, UNVERIFIED_MAX_CHARS) : null;
  return {
    unverified: {
      transmission_id: clip(transmission_id),
      event_id: clip(ev.id),
      event_type: clip(ev.event_type),
      cert_host: clip(cert_url?.host),
    },
  };
};

type VerifyResult =
  | { error: true; status: number; message: string; body?: undefined }
  | { error: false; body: string; status?: undefined; message?: undefined };

async function verified_body(
  body: string,
  headers: Headers
): Promise<VerifyResult> {
  const transmission_id = headers.get("paypal-transmission-id");
  const timestamp = headers.get("paypal-transmission-time");
  const cert_url_header = headers.get("paypal-cert-url");
  const signature = headers.get("paypal-transmission-sig");

  if (!transmission_id)
    return {
      error: true,
      status: 201,
      message: "missing paypal-transmission-id",
    };
  if (!timestamp)
    return {
      error: true,
      status: 201,
      message: "missing paypal-transmission-time",
    };
  if (!cert_url_header)
    return { error: true, status: 201, message: "missing paypal-cert-url" };
  if (!signature)
    return {
      error: true,
      status: 201,
      message: "missing paypal-transmission-sig",
    };

  const cert_url = URL.canParse(cert_url_header)
    ? new URL(cert_url_header)
    : null;
  const ref = () => delivery_ref(body, transmission_id, cert_url);
  // our config, not the sender's url: a non-2xx holds paypal's genuine
  // deliveries for redelivery once PAYPAL_API_URL is fixed
  if (cert_url && !paypal_cert_host) {
    report_error(new Error("[paypal webhook] cert host is not configured"), {
      api_host: paypal_api_host,
    });
    return { error: true, status: 503, message: "signature unverifiable" };
  }
  if (!cert_url || !is_paypal_cert_url(cert_url)) {
    report_error(new Error("[paypal webhook] cert url is not paypal's"), ref());
    return { error: true, status: 201, message: "invalid signature" };
  }

  try {
    const crc_body = crc32(body);
    const message = [
      transmission_id,
      timestamp,
      paypal_env.webhook_id,
      crc_body,
    ].join("|");

    const cert = await download_and_cache_cert(cert_url);
    const verifier = crypto.createVerify("SHA256");
    verifier.update(message);

    const signature_buffer = Buffer.from(signature, "base64");
    const is_valid = verifier.verify(cert.publicKey, signature_buffer);
    // still a 2xx: no retry makes a forged signature verify. reported because
    // paypal's own events land here too when our webhook id or crc is wrong
    if (!is_valid) {
      report_error(
        new Error("[paypal webhook] signature does not verify"),
        ref()
      );
      return { error: true, status: 201, message: "invalid signature" };
    }

    return { error: false, body };
  } catch (error) {
    // a cert paypal's host failed to serve, or a key this code can't verify
    // with, says nothing about the event; a non-2xx keeps paypal redelivering it
    const report =
      error instanceof CertHostUnreachable ? report_degraded : report_error;
    report(error, ref());
    return { error: true, status: 503, message: "signature unverifiable" };
  }
}

/** paypal's approval states map to nothing: a lifecycle event leaves the row
 * as it is, and a new row is born active */
const SUB_STATUS: Partial<Record<NonNullable<Subs["status"]>, TStatus>> = {
  ACTIVE: "active",
  SUSPENDED: "inactive",
  CANCELLED: "inactive",
  EXPIRED: "inactive",
};

/** paypal's reason for ending a subscription; a suspension can still resume */
const paypal_end_reason = (sub: Subs): string | null => {
  if (sub.status !== "CANCELLED" && sub.status !== "EXPIRED") return null;
  const reason = sub.status.toLowerCase();
  return sub.status_change_note
    ? `${reason}: ${sub.status_change_note}`
    : reason;
};

const AWAITING_CAPTURE = new Set<IDonation["status"]>(["created", "intent"]);

// a completed charge refunded or reversed since still settles: its refund or
// reversal event finds the settlement and reverses it. a v2 capture has no
// reversed status — a chargeback leaves it as it was
const SETTLEABLE_CAPTURE = new Set<Capture["status"]>([
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
// "reversed" is a live sale state the vendored v1 spec leaves out
const SETTLEABLE_SALE = new Set<string | undefined>([
  "completed",
  "partially_refunded",
  "refunded",
  "reversed",
]);

/** the resource, or the status of a lookup paypal refused for good — a
 * redelivery gets the same answer. anything else throws to a redelivery */
const fetch_resource = async <T>(get: () => Promise<T>): Promise<T | number> =>
  get().catch((e: unknown) => {
    if (is_refusal(e)) return e.http_status;
    throw e;
  });

/** paypal's copy of a capture's order; `refused` says why no redelivery
 * would read it, `unread` holds the failure one may clear */
const read_order = (
  order_id: string | undefined
): Promise<{ order: Order } | { refused: string } | { unread: unknown }> => {
  if (!order_id)
    return Promise.resolve({ refused: "its capture names no order" });
  return paypal.get_order(order_id).then(
    (order) => ({ order }),
    (e: unknown) =>
      is_refusal(e)
        ? { refused: `paypal answered ${e.http_status} for its order` }
        : { unread: e }
  );
};

const money = (value?: string, currency?: string) =>
  value ? `${value} ${currency ?? ""}`.trim() : "unknown";

interface IMoney {
  value?: string;
  currency?: string;
}

const v2_money = (m?: { value?: string; currency_code?: string }): IMoney => ({
  value: m?.value,
  currency: m?.currency_code,
});

/** how much of `whole` `parts` (refunds or reversals, signed either way) take
 * together, summed in the finest minor unit any uses, as `dec_sub` does. a
 * part in another currency counts for nothing */
const share_of = (parts: IMoney[], whole: IMoney): Share => {
  const taken = parts.flatMap((p) =>
    p.value && p.currency === whole.currency ? [p.value.replace(/^-/, "")] : []
  );
  const dp = Math.max(
    ...[...taken, whole.value ?? ""].map((v) => v.split(".")[1]?.length ?? 0)
  );
  const minor = (v: string) => Math.round(+v * 10 ** dp);
  return {
    taken: taken.reduce((sum, v) => sum + minor(v), 0),
    of: whole.value ? minor(whole.value) : Number.NaN,
  };
};

const REFUND_ALERT_FROM = "paypal-refund";

const SALE_UNSIZED =
  "paypal's v1 event names no amount of its own in the sale's currency, so it could not be sized against the sale.";

interface IReversal {
  sttl_id: string;
  /** this refund's or reversal's own part of the charge; null when it can't
   * be sized */
  share: Share | null;
  /** a refund naming no amount of its own: what paypal has refunded to date */
  refunded_to_date?: Share;
  /** a refund's time at paypal */
  refunded_at?: string;
  source: ReversalSource;
  /** paypal's refund or reversal id, recorded on what a party owes */
  ref: string | undefined;
  status: string | undefined;
  refunded: string;
  charged: string;
  /** why `share` is null, for the notice telling ops to settle it by hand */
  caveat?: string;
  /** the donation paypal's copy of the charge names, for a charge not settled here */
  owner: () => Promise<string | undefined>;
}

/**
 * takes back the donation a capture or sale settled by this refund's or
 * reversal's own part of the charge: once the gift's takes are the whole it
 * reverses, less records each party's share as owed. the entry posts the
 * notices.
 */
const reverse_settled = async (ev: WebhookEvent, c: IReversal) => {
  const don = await donation_by_sttl_id(c.sttl_id);
  if (!don) {
    const owner_id = await c.owner();
    const owner = owner_id ? await donation_get(owner_id) : undefined;
    // the settle event is still on its way: paypal guarantees no ordering
    if (owner) {
      const reason = `charge ${c.sttl_id} not settled yet`;
      report_degraded(new Error(`[paypal webhook] ${reason}`), {
        event_id: ev.id,
        event_type: ev.event_type,
        sttl_id: c.sttl_id,
      });
      return new Response(reason, { status: 503 });
    }
    // a charge of another integration on the account, or one whose settle was
    // acknowledged unroutable: no redelivery gives it a donation
    report_error(new Error("[paypal webhook] refund of a charge not ours"), {
      event_id: ev.id,
      sttl_id: c.sttl_id,
    });
    return new Response(`no donation for ${c.sttl_id}`, { status: 200 });
  }
  const lines = [
    `Of a charge of ${c.charged} (PayPal status ${c.status}).`,
    ...(c.caveat ? [c.caveat] : []),
  ];
  const res = await reverse_charge({
    donation_id: don.id,
    rail: "paypal",
    source: c.source,
    share: c.share,
    refunded_to_date: c.refunded_to_date,
    refunded_at: c.refunded_at,
    // a chargeback names no dispute: the entry lands it on the dispute filed
    // on the gift, or keeps it under its own ref for the filing to claim
    source_ref: c.ref,
    alert_from: REFUND_ALERT_FROM,
    // keyed on the event, so a duplicate delivery posts one notice
    notice: {
      id: `paypal-reversal_${ev.id}`,
      amount: c.refunded,
      ids: [`charge ${c.sttl_id}`, `event ${ev.id}`],
      lines,
    },
  });
  switch (res.status) {
    case "reversed":
      return new Response("donation reversed", { status: 200 });
    case "already_reversed":
      return new Response(`donation is ${res.donation_status}`, {
        status: 200,
      });
    case "partial_owed":
    case "partial_pending":
      return new Response("share recorded", { status: 200 });
    case "unsized":
      return new Response("unsized reversal reported", { status: 200 });
    // paypal names no unsent refunds, so the entry holds none; were it to, a
    // redelivery would hold again, so it is reported and acknowledged
    case "held":
      report_error(new Error("[paypal webhook] reversal held"), {
        event_id: ev.id,
        donation_id: don.id,
        sttl_id: c.sttl_id,
      });
      return new Response("reversal held", { status: 200 });
  }
  switch (res.reason) {
    // a rerun skips what was reversed and retries what failed, so a
    // redelivery finishes the job
    case "incomplete":
      return new Response("reversal incomplete", { status: 503 });
    // the dist lands on the queue after the settle; a redelivery finds it
    case "not_distributed":
      throw new Error(`no settled dists for donation: ${don.id}`);
    // the row was just read by this charge's id: no redelivery changes it
    case "no_donation":
    case "wrong_rail":
      report_error(new Error(`[paypal webhook] not reversed: ${res.reason}`), {
        event_id: ev.id,
        donation_id: don.id,
        sttl_id: c.sttl_id,
      });
      return new Response(`not reversed: ${res.reason}`, { status: 200 });
  }
};

/** the fields read off a `CUSTOMER.DISPUTE.*` resource; the rest carries the
 * buyer's name and email */
interface IDispute {
  dispute_id?: string;
  create_time?: string;
  update_time?: string;
  reason?: string;
  dispute_outcome?: { outcome_code?: string };
  dispute_amount?: { value?: string; currency_code?: string };
  seller_response_due_date?: string;
  disputed_transactions?: {
    seller_transaction_id?: string;
    gross_amount?: { value?: string; currency_code?: string };
  }[];
  fund_movements?: {
    party?: string;
    type?: string;
    reason?: string;
    amount?: { value?: string; currency_code?: string };
  }[];
}

const DISPUTE_FEE_REASONS = new Set(["CHARGEBACK_FEE", "DISPUTE_FEE"]);

/** the fee paypal reports debiting us for the dispute, in usd, and the line
 * telling ops what was recorded for it. a fee in another currency is no
 * figure this can owe: it counts as none */
const dispute_fee = (d: IDispute): { usd: number; line: string } => {
  const fees = (d.fund_movements ?? []).flatMap((m) =>
    m.party === "SELLER" &&
    m.type === "DEBIT" &&
    m.reason &&
    DISPUTE_FEE_REASONS.has(m.reason) &&
    m.amount?.value
      ? [{ value: m.amount.value, currency: m.amount.currency_code }]
      : []
  );
  if (fees.length === 0) {
    return { usd: 0, line: "PayPal reported no chargeback fee." };
  }
  const listed = fees.map((f) => money(f.value, f.currency)).join(", ");
  if (fees.some((f) => f.currency !== "USD")) {
    return {
      usd: 0,
      line: `Chargeback fee ${listed} is not all in USD, so none of it is recorded as owed: settle it by hand.`,
    };
  }
  // dec_sub's minor-unit arithmetic, negated: the fees summed
  const usd = -dec_sub(
    "0",
    fees.map((f) => f.value)
  );
  return { usd, line: `PayPal charged a chargeback fee of ${listed}.` };
};

/** what becomes of what a filing recorded; `partial`: what the gift has on
 * record as taken back, this dispute included, is part of the charge, which a
 * reversal records as a share, reversing nothing */
const dispute_explainer = (partial: boolean) =>
  partial
    ? "Donation stays settled even if PayPal charges this part back; what's owed comes out of next grants and is credited back if we win."
    : "Donation stays settled until a chargeback reverses it; what's owed comes out of next grants and is credited back if we win.";

const RESOLUTION_CENTER = "https://www.paypal.com/resolutioncenter/";

/** the one thing ops do on an opened dispute; no "by" without paypal's date */
const respond_action = (d: IDispute): NonNullable<Alert["action"]> => {
  const due = alert_date(d.seller_response_due_date);
  return {
    text: `Respond in the PayPal Resolution Center${due ? ` by ${due}` : ""}.`,
    url: RESOLUTION_CENTER,
  };
};

/** "UNAUTHORISED" → "Unauthorised" */
const humanize_code = (code: string) => {
  const words = code.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "6.00 of 6.00 USD": the dispute's amount out of the charge's, when both
 * are known in one currency */
const disputed_value = (d: IDispute): string | undefined => {
  const amount = d.dispute_amount;
  if (!amount?.value) return undefined;
  const gross = d.disputed_transactions?.[0]?.gross_amount;
  if (gross?.value && gross.currency_code === amount.currency_code) {
    return `${amount.value} of ${money(gross.value, gross.currency_code)}`;
  }
  return money(amount.value, amount.currency_code);
};

interface IDisputeNotice {
  /** dedupe id: a redelivery collapses into it */
  id: string;
  /** what happened, e.g. "PayPal dispute opened" */
  headline: string;
  owed?: IOwed[];
  note?: string;
  action?: Alert["action"];
}

/** an ops notice of a dispute on `don`, the donation its charge settled */
const notify_dispute = async (
  ev: WebhookEvent,
  d: IDispute,
  don: IDonation | undefined,
  n: IDisputeNotice
) => {
  const charges = (d.disputed_transactions ?? []).flatMap((t) =>
    t.seller_transaction_id ? [t.seller_transaction_id] : []
  );
  const gift = `${amount_label(d.dispute_amount?.value, d.dispute_amount?.currency_code)} to ${recipient_name(don)}`;
  const disputed = disputed_value(d);
  // a deadline is news only on the alert that asks for a response
  const respond_by = n.action && alert_date(d.seller_response_due_date);
  const fields = [
    don && recipient_field(don),
    don && donor_field(don),
    disputed && { name: "Disputed", value: disputed, inline: true as const },
    d.reason && {
      name: "Reason",
      value: humanize_code(d.reason),
      inline: true as const,
    },
    donated_field(don),
    respond_by && {
      name: "Respond by",
      value: respond_by,
      inline: true as const,
    },
  ].filter((f): f is Field => !!f);
  const ids = [
    don && `donation ${short_id(don.id)}`,
    d.dispute_id && `dispute ${d.dispute_id}`,
    charges.length > 0 && `charge ${charges.join(", ")}`,
    ev.id && `event ${ev.id}`,
  ].filter((id): id is string => !!id);
  const alert: Alert = {
    type: "NOTICE",
    from: `paypal-webhook-${stage}`,
    title: `${n.headline} · ${gift}`,
    summary: `${n.headline}: ${gift}`,
    fields,
    ...(n.owed && { table: await owed_table(n.owed) }),
    ...(n.note && { note: n.note }),
    ...(n.action && { action: n.action }),
    ...(ids.length > 0 && { context: [ids.join(" · ")] }),
  };
  await enqueue(msg("fiat-notice", { id: n.id, alert }));
};

/**
 * a dispute filed on a gift: what each of its parties received, plus the card
 * fee and any chargeback fee paypal reports, is recorded as owed at once. the
 * gift stays settled; a REVERSED of its charge, before or after this, takes
 * nothing twice.
 */
async function dispute_created(ev: WebhookEvent): Promise<Response> {
  const d = ev.resource as IDispute;
  const tx = d.disputed_transactions?.[0];
  const charge = tx?.seller_transaction_id;
  const don = charge ? await donation_by_sttl_id(charge) : undefined;
  if (!d.dispute_id || !charge || !don) {
    // keyed on the event: nothing is put on record to stop a redelivery
    await notify_dispute(ev, d, undefined, {
      id: `paypal-dispute_${ev.id}`,
      headline: "PayPal dispute opened",
      note: "No donation was settled by this charge, so nothing is recorded as owed.",
      action: respond_action(d),
    });
    return new Response("dispute reported", { status: 200 });
  }
  const fee = dispute_fee(d);
  const res = await dispute_opened({
    donation_id: don.id,
    rail: "paypal",
    dispute_id: d.dispute_id,
    opened_at: d.create_time ?? new Date().toISOString(),
    // the core adds what the gift has on record as taken back; one paypal
    // states no amount for, in the charge's currency, is the rest of it
    disputed: share_of(
      [v2_money(d.dispute_amount)],
      v2_money(tx?.gross_amount)
    ),
    fee_usd: fee.usd,
  });
  // what of the charge the open counted taken back, for the explainer
  const filed =
    res.status === "recorded" && res.owed_written
      ? await dispute_get(d.dispute_id)
      : undefined;
  // told on the first sighting, and again only when what is owed grows: a
  // redelivery tells nothing
  const news = ((): Pick<IDisputeNotice, "owed" | "note"> | null => {
    switch (res.status) {
      case "closed":
        return null;
      case "failed":
        return {
          note: `Nothing recorded as owed: ${res.reason}. Settle it by hand.`,
        };
      case "already_reversed":
        return res.inserted
          ? {
              note: `The donation was already ${res.donation_status}, so nothing more is recorded as owed.`,
            }
          : null;
      case "recorded": {
        // a dispute closed with no decision, or a chargeback reversed before
        // this filing, recorded the rows first: their ref stands
        const prior =
          res.prior_refs.length > 0
            ? [
                `What's owed stands under ${res.prior_refs.join(", ")}, recorded before this dispute; its share is merged in and credited back if we win.`,
              ]
            : [];
        if (res.owed_written) {
          return {
            owed: res.owed,
            note: [
              ...prior,
              fee.line,
              dispute_explainer((filed?.cumulative_share ?? 1) < 1),
            ].join("\n"),
          };
        }
        if (!res.inserted) return null;
        if (res.owed.length === 0) {
          return {
            note: "Nothing settled to the gift's parties yet, so nothing is recorded as owed.",
          };
        }
        return {
          owed: res.owed,
          note: [
            "Nothing more recorded as owed for this dispute; the table is what the payment already owes.",
            ...prior,
          ].join("\n"),
        };
      }
    }
  })();
  if (news) {
    await notify_dispute(ev, d, don, {
      id: `paypal-dispute_${d.dispute_id}`,
      headline: "PayPal dispute opened",
      ...news,
      action: respond_action(d),
    });
  }
  return new Response(`dispute ${res.status}`, { status: 200 });
}

/** outcomes that end the dispute's own take with no loss of it, and how its
 * record closes. ACCEPTED: the claim is paid through a refund, whose own take
 * counts it. NONE: paypal closed it because a new dispute was filed on the
 * same transaction, whose filing takes the share again */
const CLOSED_WITHOUT_LOSS: Partial<
  Record<string, "accepted" | "inquiry_closed">
> = { ACCEPTED: "accepted", NONE: "inquiry_closed" };

/** outcomes where we keep the money, credited back as a win: the buyer
 * cancelled, the claim was denied, or paypal paid the buyer itself */
const SELLER_KEEPS_OUTCOMES = new Set([
  "RESOLVED_SELLER_FAVOUR",
  "CANCELED_BY_BUYER",
  "DENIED",
  "RESOLVED_WITH_PAYOUT",
]);

/** an outcome paypal sent after the dispute was recorded closed otherwise
 * (an appeal): the first close stands and nothing moves, so ops settle it.
 * keyed on the event, so a redelivery collapses into it */
const notify_outcome_changed = (
  ev: WebhookEvent,
  d: IDispute,
  don: IDonation,
  note: string
) =>
  notify_dispute(ev, d, don, {
    id: `paypal-dispute-changed_${ev.id}`,
    headline: "PayPal dispute outcome changed",
    note,
  });

/** a dispute resolved. an outcome that leaves us the money credits back what
 * its filing recorded; one this can't read is ops' to settle */
async function dispute_resolved(ev: WebhookEvent): Promise<Response> {
  const d = ev.resource as IDispute;
  const tx = d.disputed_transactions?.[0];
  const charge = tx?.seller_transaction_id;
  const don = charge ? await donation_by_sttl_id(charge) : undefined;
  if (!d.dispute_id || !don)
    return new Response("no donation", { status: 200 });
  const outcome = d.dispute_outcome?.outcome_code;
  // finds a chargeback of it recorded before its filing was
  const disputed = share_of(
    [v2_money(d.dispute_amount)],
    v2_money(tx?.gross_amount)
  );
  const record = {
    id: d.dispute_id,
    donation_id: don.id,
    opened_at: d.create_time ?? new Date().toISOString(),
    closed_at: d.update_time ?? new Date().toISOString(),
  };
  const closed_as = outcome ? CLOSED_WITHOUT_LOSS[outcome] : undefined;
  if (closed_as) {
    const closed = await dispute_won({
      donation_id: don.id,
      rail: "paypal",
      dispute_id: record.id,
      status: closed_as,
      disputed,
      opened_at: record.opened_at,
      closed_at: record.closed_at,
    });
    // the charge's own donation, just read: no redelivery changes the answer
    if (closed.status === "failed") {
      report_error(
        new Error(
          `[paypal webhook] dispute close not credited: ${closed.reason}`
        ),
        { event_id: ev.id, dispute_id: record.id, donation_id: don.id }
      );
    }
    if (closed.status === "conflict") {
      await notify_outcome_changed(
        ev,
        d,
        don,
        `Closed ${closed_as} after it was recorded ${closed.prior_status}. What it took stays owed; credit it by hand if PayPal returned the money.`
      );
    }
    return new Response(`dispute ${outcome}`, { status: 200 });
  }
  if (outcome === "RESOLVED_BUYER_FAVOUR") {
    // paypal's own REVERSED takes the money back
    const stands = await dispute_close(db, { ...record, status: "lost" });
    if (stands !== "lost") {
      await notify_outcome_changed(
        ev,
        d,
        don,
        `Lost on appeal after it was recorded ${stands}. Nothing is owed again; recover it by hand.`
      );
    }
    return new Response(`dispute ${outcome}`, { status: 200 });
  }
  if (!outcome || !SELLER_KEEPS_OUTCOMES.has(outcome)) {
    // its own share on record: its filing recorded what is owed, into
    // whatever row a refund or an earlier dispute wrote first
    const filed = (await dispute_get(record.id))?.share != null;
    const owing = filed ? await owed_for_donation(don.id) : [];
    if (owing.length > 0) {
      // keyed on the dispute: a redelivery collapses into it in the queue's
      // dedupe window
      await notify_dispute(ev, d, don, {
        id: `paypal-dispute-resolved_${d.dispute_id}`,
        headline: "PayPal dispute resolved",
        owed: owing,
        note: `Resolved ${outcome ?? "with no outcome"}, which doesn't say who kept the money, so what's owed stays owed. If PayPal took no money back, credit or write it off by hand on Amounts owed.`,
      });
    }
    return new Response(`dispute ${outcome ?? "with no outcome"}`, {
      status: 200,
    });
  }
  // read before the win records it won: a redelivery tells nothing again
  const was_won = (await dispute_get(record.id))?.status === "won";
  const won = await dispute_won({
    donation_id: don.id,
    rail: "paypal",
    dispute_id: record.id,
    disputed,
    opened_at: record.opened_at,
    closed_at: record.closed_at,
  });
  // the charge's own donation, just read: no redelivery changes the answer
  if (won.status === "failed") {
    report_error(
      new Error(`[paypal webhook] dispute win not credited: ${won.reason}`),
      { event_id: ev.id, dispute_id: record.id, donation_id: don.id }
    );
    return new Response(`dispute not credited: ${won.reason}`, {
      status: 200,
    });
  }
  if (won.status === "conflict") {
    await notify_outcome_changed(
      ev,
      d,
      don,
      `Won after it was recorded ${won.prior_status}. The chargeback stays owed; credit it by hand if PayPal returned the money.`
    );
  }
  // once per dispute: a redelivery finds it on record won already
  if (won.status === "already_reversed" && won.prior_status !== "won") {
    await notify_dispute(ev, d, don, {
      id: `paypal-dispute-won_${d.dispute_id}`,
      headline: "PayPal dispute won on a reversed donation",
      note: `Resolved ${outcome}, leaving us the money, but the donation was already ${won.donation_status}. If PayPal's chargeback reversed it, restore the donation, its dists and what's owed by hand; if a refund did, nothing is owed back.`,
    });
  }
  if (won.status === "credited" && won.owed.length === 0 && !was_won) {
    const owing = (await owed_for_donation(don.id)).filter(
      (o) => (o.outstanding_usd ?? 0) >= 0.01
    );
    if (owing.length > 0) {
      await notify_dispute(ev, d, don, {
        id: `paypal-dispute-won-uncredited_${record.id}`,
        headline: "PayPal dispute won, nothing credited",
        owed: owing,
        note: `Resolved ${outcome}, leaving us the money, but its filing recorded nothing owed, so nothing was credited back. If any of the table is this dispute's share, credit it by hand on Amounts owed.`,
      });
    }
  }
  return new Response(`dispute ${won.status}`, { status: 200 });
}

// -- route action --

/**
 * paypal redelivers any non-2xx up to 25 times over 3 days, always with the
 * same payload — so a delivery missing what the route needs is reported and
 * acknowledged. anything a later attempt could fix keeps its non-2xx.
 */
const unroutable = (ev: WebhookEvent, reason: string) => {
  report_error(new Error(`[paypal webhook] unroutable: ${reason}`), {
    event_id: ev.id,
    event_type: ev.event_type,
    resource_id: ev.resource?.id,
  });
  return new Response(`not routable: ${reason}`, { status: 200 });
};

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.text();
    const result = await verified_body(body, request.headers);
    if (result.error)
      return new Response(result.message, { status: result.status });

    const ev: WebhookEvent = JSON.parse(result.body);

    console.info(
      `[paypal webhook] received: ${ev.event_type} ${ev.id} resource ${ev.resource?.id}`
    );

    switch (ev.event_type) {
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const {
          id: subs_id,
          subscriber,
          custom_id: don_id,
          create_time = new Date().toISOString(),
          update_time = new Date().toISOString(),
        } = ev.resource as Subs;

        if (!don_id) return unroutable(ev, "missing don id");
        const don = await donation_get(don_id);
        if (!don) return new Response("don record not found", { status: 500 });

        //create subs record
        if (!subscriber?.email_address)
          return unroutable(ev, "missing subscriber email");

        const donor = donor_update(
          subscriber.email_address,
          subscriber.name,
          subscriber.shipping_address?.address
        );

        // update the donation with donor info
        const updated_don = await donation_update(db, don_id, donor);
        console.info(`don donor info updated: ${updated_don.id}`);

        if (!subs_id) return unroutable(ev, "missing subscription id");

        const subs_db = await build_sub_record({
          subs_id,
          sub: ev.resource as Subs,
          don,
          from_email: updated_don.from_email,
          create_time,
          update_time,
        });
        if (typeof subs_db === "string") return unroutable(ev, subs_db);
        if ("refused" in subs_db)
          return unroutable(ev, `paypal answered ${subs_db.refused} for plan`);

        await sub_put(db, subs_db);
        return new Response(`created subscription record ${subs_id}`, {
          status: 200,
        });
      }
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.SUSPENDED":
      case "BILLING.SUBSCRIPTION.EXPIRED":
      case "BILLING.SUBSCRIPTION.RE-ACTIVATED":
      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
        const subs_id = (ev.resource as Subs).id;
        if (!subs_id) return unroutable(ev, "missing subscription id");
        // read from paypal, not the event: lifecycle events arrive in no order
        const sub = await fetch_resource(() =>
          paypal.get_subscription(subs_id)
        );
        if (typeof sub === "number")
          return unroutable(
            ev,
            `paypal answered ${sub} for subscription ${subs_id}`
          );

        const status = sub.status ? SUB_STATUS[sub.status] : undefined;
        const next_billing = sub.billing_info?.next_billing_time;
        // ended or paused at paypal already, so no sub-deactivated: that
        // message cancels at the provider
        const { row } = await sub_update(db, subs_id, {
          ...(status && { status }),
          ...(next_billing && {
            next_billing: new Date(next_billing).toISOString(),
          }),
        });
        // the activation that creates the row is still on its way
        if (!row) {
          const reason = `subscription ${subs_id} not recorded yet`;
          report_degraded(new Error(`[paypal webhook] ${reason}`), {
            event_id: ev.id,
            event_type: ev.event_type,
            subs_id,
          });
          return new Response(reason, { status: 503 });
        }
        // the first reason recorded stays: a donor's cancel here reaches
        // paypal and comes back as this event
        const end_reason = paypal_end_reason(sub);
        if (end_reason)
          await sub_cancel_reason_default(db, subs_id, end_reason);
        return new Response(`subscription ${subs_id} is ${row.status}`, {
          status: 200,
        });
      }
      case "CHECKOUT.ORDER.APPROVED": {
        const {
          id: order_id,
          payment_source,
          purchase_units,
        } = ev.resource as Order;

        if (!order_id) return unroutable(ev, "missing order id");
        const don_id = purchase_units?.[0]?.custom_id;
        if (!don_id)
          return unroutable(ev, `missing onhold id for order: ${order_id}`);

        const ps = payment_source?.venmo || payment_source?.paypal;
        // written before the capture, so its completed event finds the payer
        if (ps?.email_address)
          await donation_update(
            db,
            don_id,
            donor_update(ps.email_address, ps.name, ps.address)
          );

        // not captured here: this event lands as the browser's own capture
        // runs, under the same request id. a check held past it captures
        // only an order still APPROVED
        await schedule(
          msg("paypal-order-capture", {
            order_id,
            don_id,
            scheduled_at: new Date().toISOString(),
          })
        );

        // a payer left off the approval is not lost: the capture's completed
        // event reads the donor off paypal's copy of the order
        return new Response("capture check scheduled", { status: 200 });
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        const { id: cid } = ev.resource as Capture;
        if (!cid) return unroutable(ev, "missing capture id");

        // idempotency: already processed this capture. rechecked under the
        // order row's lock below — this one only spares a redelivery the
        // paypal fetches and the settle math.
        if (await settlement_exists(cid)) {
          console.info(
            `[paypal webhook] capture ${cid} already settled, skipping`
          );
          // a capture only ever settles its order's own row
          const row = await donation_by_sttl_id(cid);
          await requeue(row, row?.id ?? "");
          return new Response("already processed", { status: 200 });
        }

        // the donation and the amounts come from paypal's copy: the signature
        // is the only check on the event body
        const capture = await fetch_resource(() => paypal.get_capture(cid));
        // as for a sale: a signed event naming a capture paypal can't find is
        // our lookup gone wrong, and acking it drops the payment
        if (typeof capture === "number") {
          report_error(
            new Error(
              `[paypal webhook] paypal answered ${capture} for capture`
            ),
            { event_id: ev.id, capture_id: cid, http_status: capture }
          );
          return new Response("capture lookup refused", { status: 503 });
        }
        const {
          create_time: create_date = new Date().toISOString(),
          custom_id: don_id,
          seller_receivable_breakdown: b,
          supplementary_data,
          status,
        } = capture;
        if (!don_id)
          return unroutable(ev, `missing onhold id for capture: ${cid}`);
        if (!status || !SETTLEABLE_CAPTURE.has(status))
          return unroutable(ev, `capture ${cid} is ${status}`);

        if (!b?.gross_amount)
          return unroutable(ev, `missing gross amount for capture ${cid}`);

        const platform_fees = b.platform_fees ?? [];
        // a fallback net subtracts these from gross, which only works in one currency
        if (
          !b.net_amount &&
          platform_fees.some(
            (f) => f.amount.currency_code !== b.gross_amount.currency_code
          )
        )
          return unroutable(
            ev,
            `platform fee currency differs from gross for capture ${cid}`
          );

        // only gross_amount is required in the breakdown; fee and net may be absent
        const settled = ((r): ISettlement => {
          const p = b.paypal_fee?.value ?? "0";
          const n =
            b.net_amount?.value ??
            dec_sub(b.gross_amount.value, [
              p,
              ...platform_fees.map((f) => f.amount.value),
            ]);
          const c = b.net_amount?.currency_code ?? b.gross_amount.currency_code;
          if (r) {
            return { net: +n * +r, fee: +p * +r, c };
          }
          return { net: +n, fee: +p, c };
        })(b.exchange_rate?.value);

        const order_id = supplementary_data?.related_ids?.order_id;
        const read = await read_order(order_id);
        const ps =
          "order" in read
            ? read.order.payment_source?.venmo ||
              read.order.payment_source?.paypal
            : undefined;
        // a payer who withholds their email may still give a name or address
        const donor = ps ? paypal_donor_update(ps) : {};
        if (Object.keys(donor).length > 0)
          await donation_update(db, don_id, donor);

        const prior = await donation_get(don_id);
        if (!prior)
          return new Response(`donation not found: ${don_id}`, { status: 500 });

        // the order read is the one chance at a name or address the browser's
        // capture failed to save, and a settled capture never reads it again:
        // a read that may heal is worth an hour of redeliveries, email or not
        if ("unread" in read) {
          const age_ms = Date.now() - new Date(prior.created_at).getTime();
          if (age_ms < 60 * 60 * 1000) {
            console.warn(
              `[paypal webhook] order of ${don_id} unread, requesting retry`
            );
            return new Response("order unread, retry later", { status: 503 });
          }
        }

        // what settling on this read leaves ops to look at
        const finding = (() => {
          if (prior.from_email !== PLACEHOLDER_EMAIL)
            return "unread" in read
              ? {
                  report: report_error,
                  what: "with its order unread after an hour",
                  cause: read.unread,
                }
              : undefined;
          const on = (why: string) => `on the placeholder email: ${why}`;
          if ("refused" in read)
            return { report: report_error, what: on(read.refused) };
          // a captured order's payment_source is final: a payer who withheld
          // their email (routine on venmo) never gains one on redelivery
          if ("order" in read)
            return ps
              ? { report: report_degraded, what: on("the payer withheld it") }
              : {
                  report: report_error,
                  what: on("its order has no payer wallet"),
                };
          return {
            report: report_error,
            what: on("its order is unread after an hour"),
            cause: read.unread,
          };
        })();

        const sttl_record = {
          id: cid,
          date: create_date,
          currency: "USD",
          fee: settled.fee,
          net: settled.net,
        };

        const result = calc_donation_settle({
          kind: "one-time",
          order_id: don_id,
          prior,
          settlement: sttl_record,
        });
        // the refund already reversed this donation; a 2xx so paypal stops
        // redelivering rather than a throw that reads as a broken endpoint.
        if (result.op === "noop")
          return Response.json({ id: don_id }, { status: 200 });
        if (result.op !== "update")
          throw new Error("unexpected put for paypal capture");

        const p = await db.transaction(
          async (
            tx
          ): Promise<
            | { op: "dup"; row: IDonation | undefined }
            | { op: "reversed" }
            | { op: "settled"; row: IDonation }
          > => {
            // the guard above read outside this transaction, so two concurrent
            // deliveries of one capture can both pass it. re-decide under the
            // order row's write lock, where the loser reads what the winner
            // committed.
            const state = await donation_settle_state_locked(
              tx,
              result.order_id
            );
            if (!state) throw new Error(`donation not found: ${don_id}`);
            if (await settlement_exists(cid, tx))
              return { op: "dup", row: await donation_by_sttl_id(cid, tx) };
            // `result.patch` was computed from a read taken before the lock; a
            // refund committed since then must not be written back to settled.
            if (is_reversed(state.status)) return { op: "reversed" };
            return {
              op: "settled",
              row: await donation_update(tx, result.order_id, result.patch),
            };
          }
        );

        if (p.op === "reversed")
          return Response.json({ id: don_id }, { status: 200 });
        if (p.op === "dup") {
          await requeue(p.row, don_id);
          return new Response("already processed", { status: 200 });
        }
        // before the enqueue: a throw there redelivers into the dup branch,
        // which never reports
        finding?.report(
          new Error(`[paypal webhook] settled ${don_id} ${finding.what}`, {
            cause: finding.cause,
          }),
          { don_id, event_id: ev.id, capture_id: cid, order_id }
        );
        await enqueue(...result.msgs);

        console.info(`donation settled: ${p.row.id}`);
        return Response.json({ id: p.row.id });
      }
      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.CAPTURE.REVERSED": {
        // the resource is the refund; the capture it reverses is its `up` link
        const refund = ev.resource as {
          id?: string;
          create_time?: string;
          amount?: { value?: string; currency_code?: string };
          seller_payable_breakdown?: {
            total_refunded_amount?: { value?: string; currency_code?: string };
          };
          links?: { rel?: string; href?: string }[];
        };
        const up = refund.links?.find((l) => l.rel === "up")?.href;
        const cid = up?.match(/\/v2\/payments\/captures\/([^/?#]+)$/)?.[1];
        if (!cid) return unroutable(ev, "missing refunded capture id");

        const capture = await fetch_resource(() => paypal.get_capture(cid));
        if (typeof capture === "number")
          return unroutable(
            ev,
            `paypal answered ${capture} for capture ${cid}`
          );
        const gross = capture.amount;
        const part = refund.amount;
        const is_reversal = ev.event_type === "PAYMENT.CAPTURE.REVERSED";
        const taken = { value: part?.value, currency: part?.currency_code };
        const whole = { value: gross?.value, currency: gross?.currency_code };
        // its own part: the entry counts the gift's other refunds and
        // disputes from their own takes. a capture paypal marks refunded in
        // full is the whole, whatever events before it were missed
        const alone = share_of([taken], whole);
        const sized =
          capture.status === "REFUNDED"
            ? { share: WHOLE }
            : alone.taken > 0
              ? { share: alone }
              : is_reversal
                ? { share: null }
                : {
                    share: null,
                    refunded_to_date: share_of(
                      [
                        v2_money(
                          refund.seller_payable_breakdown?.total_refunded_amount
                        ),
                      ],
                      whole
                    ),
                  };
        return reverse_settled(ev, {
          sttl_id: cid,
          ...sized,
          source: is_reversal ? "dispute" : "refund",
          ref: refund.id,
          refunded_at: is_reversal ? undefined : refund.create_time,
          status: capture.status,
          refunded: money(part?.value, part?.currency_code),
          charged: money(gross?.value, gross?.currency_code),
          owner: async () => capture.custom_id,
        });
      }
      case "PAYMENT.SALE.REFUNDED":
      case "PAYMENT.SALE.REVERSED": {
        // a v1 refund naming its sale, or the reversed sale itself
        const r = ev.resource as {
          id?: string;
          sale_id?: string;
          create_time?: string;
          amount?: { total?: string; currency?: string };
        };
        const is_sale =
          (ev as { resource_type?: string }).resource_type === "sale";
        const sale_id = is_sale ? r.id : r.sale_id;
        if (!sale_id) return unroutable(ev, "missing refunded sale id");

        const sale = await fetch_resource(() => paypal.get_sale(sale_id));
        if (typeof sale === "number")
          return unroutable(ev, `paypal answered ${sale} for sale ${sale_id}`);
        // "reversed" is a live sale state the vendored v1 spec leaves out
        const state: string | undefined = sale.state;
        const whole = sale.amount;
        const is_reversal = ev.event_type === "PAYMENT.SALE.REVERSED";
        const alone = share_of(
          [{ value: r.amount?.total, currency: r.amount?.currency }],
          { value: whole?.total, currency: whole?.currency }
        );
        const sized =
          state === "refunded" || state === "reversed"
            ? { share: WHOLE }
            : !is_sale && alone.taken > 0
              ? { share: alone }
              : { share: null, caveat: SALE_UNSIZED };
        return reverse_settled(ev, {
          sttl_id: sale_id,
          ...sized,
          source: is_reversal ? "dispute" : "refund",
          ref: r.id,
          refunded_at: is_reversal ? undefined : r.create_time,
          status: state,
          refunded: money(r.amount?.total, r.amount?.currency),
          charged: money(whole?.total, whole?.currency),
          owner: async () => {
            const subs_id = sale.billing_agreement_id;
            if (!subs_id) return undefined;
            const sub = await fetch_resource(() =>
              paypal.get_subscription(subs_id)
            );
            return typeof sub === "number" ? undefined : sub.custom_id;
          },
        });
      }
      case "PAYMENT.CAPTURE.DENIED": {
        const { id: cid, custom_id: don_id } = ev.resource as Capture;
        if (!cid || !don_id)
          return unroutable(ev, "missing capture or donation id");

        // the row is written before its order exists, so no redelivery brings it
        const don = await donation_get(don_id);
        if (!don) return unroutable(ev, `no donation for capture ${cid}`);
        if (!AWAITING_CAPTURE.has(don.status))
          return new Response(`donation is ${don.status}`, { status: 200 });

        const alert = {
          type: "NOTICE" as const,
          from: `paypal-webhook-${stage}`,
          title: "PayPal Capture Denied",
          body: [
            `donation ${don_id}, capture ${cid}, event ${ev.id}`,
            "paypal denied a capture it had held pending. the donor saw the thank-you page; the donation is marked failed and nothing was settled.",
          ].join("\n"),
        };
        // enqueued before the write: once failed, a redelivery stops at the
        // status above and a failed enqueue is never retried. keyed on the
        // capture, so deliveries racing past that status post one notice
        await enqueue(
          msg("fiat-notice", { id: `paypal-denied_${cid}`, alert })
        );
        await db.transaction(async (tx) => {
          const state = await donation_settle_state_locked(tx, don_id);
          if (state && AWAITING_CAPTURE.has(state.status))
            await donation_update(tx, don_id, { status: "failed" });
        });
        return new Response("donation failed", { status: 200 });
      }
      case "PAYMENT.CAPTURE.PENDING": {
        const {
          id: cid,
          custom_id: don_id,
          status_details,
        } = ev.resource as Capture;
        report_degraded(new Error("[paypal webhook] capture pending"), {
          capture_id: cid,
          don_id,
          reason: status_details?.reason,
        });
        return new Response("capture pending", { status: 200 });
      }
      case "CUSTOMER.DISPUTE.CREATED":
        return dispute_created(ev);
      case "CUSTOMER.DISPUTE.RESOLVED":
        return dispute_resolved(ev);
      case "PAYMENT.SALE.COMPLETED": {
        const { id: sale_id, billing_agreement_id: ev_subs_id } =
          ev.resource as Sale;
        if (!sale_id) return unroutable(ev, "missing sale id");

        // idempotency: already processed this sale. rechecked under the order
        // row's lock below — this one only spares a redelivery the paypal
        // fetches and the settle math.
        if (await settlement_exists(sale_id)) {
          console.info(
            `[paypal webhook] sale ${sale_id} already settled, skipping`
          );
          await requeue_sale(sale_id, ev_subs_id);
          return new Response("already processed", { status: 200 });
        }

        // as for a capture: settled from paypal's copy, not the event body
        const sale = await fetch_resource(() => paypal.get_sale(sale_id));
        // a signed event naming a charge paypal can't find is a lookup of ours
        // gone wrong, not a bad payload: held for redelivery, since acking it
        // drops a recurring charge
        if (typeof sale === "number") {
          report_error(
            new Error(`[paypal webhook] paypal answered ${sale} for sale`),
            { event_id: ev.id, sale_id, http_status: sale }
          );
          return new Response("sale lookup refused", { status: 503 });
        }
        const {
          create_time: create_date = new Date().toISOString(),
          // the signed event's id stands in when paypal's copy leaves it off
          billing_agreement_id: subs_id = ev_subs_id,
          transaction_fee,
          receivable_amount,
          amount: sale_amount,
          exchange_rate: rate, // unit per usd
          state,
        } = sale;
        if (!state || !SETTLEABLE_SALE.has(state))
          return unroutable(ev, `sale ${sale_id} is ${state}`);

        if (!sale_amount?.total)
          return unroutable(ev, `missing total for sale: ${sale_id}`);

        const tf = transaction_fee?.value ?? "0";
        // receivable_amount only present on currency conversions
        const net =
          receivable_amount?.value ?? dec_sub(sale_amount.total, [tf]);
        const cur = receivable_amount?.currency ?? sale_amount.currency;

        const settled: ISettlement = {
          net: +net,
          fee: rate ? +tf * +rate : +tf,
          c: cur,
        };

        if (!subs_id) return unroutable(ev, "missing billing agreement id");
        const sub = await fetch_resource(() =>
          paypal.get_subscription(subs_id)
        );
        if (typeof sub === "number")
          return unroutable(
            ev,
            `paypal answered ${sub} for subscription ${subs_id}`
          );
        if (!sub)
          return new Response("subscription not found", { status: 400 });
        // no redelivery supplies either on its own. custom_id is patchable
        // (subscriptions PATCH, add/replace); after patching it, resend this
        // event by the event_id in the report. of the subscriber, only
        // shipping_address is patchable, so a missing subscriber or email has
        // no recovery.
        if (!sub.subscriber) return unroutable(ev, "missing subscriber info");
        if (!sub.custom_id) return unroutable(ev, "missing onhold id");
        const don_id = sub.custom_id;
        const { email_address: email, shipping_address, name } = sub.subscriber;
        if (!email) return unroutable(ev, "missing subscriber email");

        const donor = donor_update(email, name, shipping_address?.address);

        const don = await donation_get(don_id);
        if (!don) return new Response("don record not found", { status: 500 });

        // a charge settles whatever state its subscription is in by now: a donor
        // who cancels after paying was still charged. only a row this sale has
        // to create needs the plan — built before opening the tx, since
        // build_sub_record makes an external paypal.get_plan call we don't want
        // to hold a db connection open for.
        let subs_db: ISub | undefined;
        if (!(await sub_get(subs_id))) {
          // the one gap a redelivery closes: paypal fills in billing_info on
          // activation
          if (sub.status === "APPROVAL_PENDING" || sub.status === "APPROVED")
            return new Response(`subscription ${subs_id} is ${sub.status}`, {
              status: 400,
            });
          const rec = await build_sub_record({
            subs_id,
            sub,
            don,
            // use the subscriber email directly: if SALE.COMPLETED races ahead
            // of BILLING.SUBSCRIPTION.ACTIVATED, don.from_email is still the
            // placeholder, and sub_put's onConflictDoNothing would freeze it in.
            from_email: email,
            last_charge_time: create_date,
          });
          if (typeof rec === "string") return unroutable(ev, rec);
          if ("refused" in rec)
            return unroutable(
              ev,
              `paypal answered ${rec.refused} for plan ${sub.plan_id}`
            );
          subs_db = rec;
        }
        const next_billing = sub.billing_info?.next_billing_time;

        const sttl_record = {
          id: sale_id,
          date: create_date,
          currency: cur,
          fee: settled.fee,
          net: settled.net,
        };

        const p = await db.transaction(async (tx) => {
          // the guard above read outside this transaction, so two concurrent
          // deliveries of one sale can both pass it. re-decide under the order
          // row's write lock: without it the loser sees the settlement the
          // winner wrote, takes the rebill branch, and clones a donation that
          // loses on the sttl_id unique index.
          const state = await donation_settle_state_locked(tx, don_id);
          if (!state) throw new Error(`don record not found: ${don_id}`);
          if (await settlement_exists(sale_id, tx))
            return {
              dup: true as const,
              row: await donation_by_sttl_id(sale_id, tx),
              msgs: [],
            };

          const don = await donation_update(tx, don_id, { ...donor });
          // upsert subscription row before referencing its FK on the donation;
          // BILLING.SUBSCRIPTION.ACTIVATED may not have landed yet (paypal does
          // not guarantee webhook ordering).
          if (subs_db) await sub_put(tx, subs_db);
          // sub_put leaves an existing row alone; each charge moves it on
          if (next_billing)
            await sub_update(tx, subs_id, {
              next_billing: new Date(next_billing).toISOString(),
            });

          const result = don.settlement
            ? calc_donation_settle({
                kind: "rebill",
                order_id: don_id,
                prior: don as IDonationSettled,
                settlement: sttl_record,
                subs_id,
                new_id: crypto.randomUUID(),
              })
            : calc_donation_settle({
                kind: "first-recurring",
                order_id: don_id,
                prior: don,
                settlement: sttl_record,
                subs_id,
              });

          // noop reaches here only from the first-recurring branch — a rebill
          // clones the order row rather than settling it, so it never yields
          // one. the order row it would have settled is already reversed.
          if (result.op === "noop")
            return { dup: false as const, row: don, msgs: [] };
          return result.op === "update"
            ? {
                dup: false as const,
                row: await donation_update(tx, result.order_id, result.patch),
                msgs: result.msgs,
              }
            : {
                dup: false as const,
                row: await donation_put(tx, result.row),
                msgs: result.msgs,
              };
        });

        if (p.dup) {
          await requeue(p.row, don_id);
          return new Response("already processed", { status: 200 });
        }
        await enqueue(...p.msgs);

        return Response.json({ id: p.row.id });
      }
    }
    console.info(
      `[paypal webhook] not handled: ${ev.event_type} ${ev.id} resource ${ev.resource?.id}`
    );
    return new Response(`event type not handled: ${ev.event_type}`, {
      status: 201,
    });
  } catch (error) {
    return report_resp(error, "error processing webhook");
  }
}
