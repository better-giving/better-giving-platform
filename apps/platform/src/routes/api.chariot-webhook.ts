import crypto from "node:crypto";
import type { Grant } from "@better-giving/chariot";
import { report_error, report_resp } from "#/errors/report";
import {
  type ChariotMetadata,
  calc_donation_settle,
  type IDonation,
  type IDonationSettled,
  type ISettlement,
  settle_msgs,
  type TStatus,
} from "@/donations";
import { chariot as chariot_env, stage } from "$/env";
import { chariot } from "$/kit/chariot";
import { enqueue } from "$/kit/queue";
import { aws_monitor } from "$/kit/slack";
import { partner_donation_of_grant } from "$/partner/grant-donation";
import { db } from "$/pg/db";
import { donation_has_dists } from "$/pg/queries/dist";
import {
  donation_get,
  donation_settle_state_locked,
  donation_update,
} from "$/pg/queries/donation";
import type { Route } from "./+types/api.chariot-webhook";

/** `t=<iso-8601>,v1=<hex>[,v1=<hex>…]` — collects every `v1`, any of which may match; other schemes are ignored so a weaker one can't stand in for `v1` */
function parse_signature(header: string): { t: string; v1: string[] } | null {
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    if (key === "t") t = value;
    else if (key === "v1") v1.push(value);
  }
  return t && v1.length ? { t, v1 } : null;
}

const on_grant_canceled: Record<TStatus, "cancel" | "keep" | "alert"> = {
  created: "cancel",
  intent: "cancel",
  confirmed: "cancel",
  // final with no money moved: nothing to cancel or reverse
  cancelled: "keep",
  expired: "keep",
  failed: "keep",
  // money already moved: a settled row needs reversing by hand; a refunded one
  // was already reversed, so what is left is a platform loss to record
  settled: "alert",
  refunded: "alert",
  refunded_loss: "alert",
};

const refunded_todo =
  "the donor was already refunded for a grant that will never pay; record the refund as a platform loss";
const on_canceled_todo: Partial<Record<TStatus, string>> = {
  settled: "reverse the donation with the refund tooling",
  refunded: refunded_todo,
  refunded_loss: refunded_todo,
};

// a completed grant is the fund's payout, so it settles any row not already
// final; completing a cancelled row means chariot reversed its own cancel,
// which a person confirms before it settles
const on_grant_completed: Record<TStatus, "settle" | "duplicate" | "alert"> = {
  created: "settle",
  intent: "settle",
  confirmed: "settle",
  expired: "settle",
  failed: "settle",
  cancelled: "alert",
  settled: "duplicate",
  refunded: "duplicate",
  refunded_loss: "duplicate",
};

interface IGrantRef {
  id: string;
  amount: number;
  createdAt?: string;
  statuses?: readonly { createdAt?: string }[];
}

/** chariot doesn't promise `statuses` in date order */
const dates_of = (statuses: readonly { createdAt?: string }[] = []) =>
  statuses
    .flatMap((x) => (x.createdAt ? [x.createdAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b));

/** what an operator needs to act on: the money and whose it is, never the donor */
const grant_facts = (grant: IGrantRef, don?: IDonation, sttl_id?: string) =>
  [
    `amount ${(grant.amount / 100).toFixed(2)} USD`,
    don && `recipient ${don.to_name} (${don.to_id})`,
    `grant ${grant.id}`,
    sttl_id && `settlement ${sttl_id}`,
  ]
    .filter(Boolean)
    .join(", ");

/**
 * the enqueue follows the settle's commit, so a delivery can leave a settled
 * row whose messages never went out, or only some; its redelivery is what
 * re-sends them. receipt and match absorb a repeat downstream (send claim,
 * unique donation_id); the dist goes only while none exists, since a fund's
 * split is recomputed per run and a newly active member would get a share.
 */
async function requeue(row: IDonationSettled) {
  const distributed = await donation_has_dists(row.id);
  const msgs = settle_msgs(row, { match: true }).filter(
    (m) => !(distributed && m.id === "don-sttl-dist")
  );
  await enqueue(...msgs);
}

interface IOpsAlert {
  /** sentry error message */
  message: string;
  title: string;
  /** safe to log: ids and statuses only */
  detail: string;
  facts: string;
  todo: string;
  ctx: Record<string, unknown>;
}

async function alert_ops({
  message,
  title,
  detail,
  facts,
  todo,
  ctx,
}: IOpsAlert) {
  report_error(new Error(message), ctx);
  // the report above already holds the event; a slack outage must not
  // 500 the ack into redeliveries that re-report it
  await aws_monitor
    .send_alert({
      type: "ERROR",
      from: `chariot-webhook:${stage}`,
      title,
      body: `${detail}. ${facts}. ${todo}.`,
    })
    .catch((err) => report_error(err, ctx));
  console.warn(`[chariot webhook] ${detail}: left unchanged, alerted`);
}

/**
 * a row still missing past the recording grace, or a state no delivery can repair: a 5xx buys ten
 * redeliveries that change nothing, and five days of them disable the
 * subscription for every grant, so a person is told and chariot gets its 2xx
 */
async function ack_unfixable(
  grant: IGrantRef,
  don_id: string,
  what: Pick<IOpsAlert, "message" | "title" | "detail" | "todo">,
  don?: IDonation
) {
  await alert_ops({
    ...what,
    facts: grant_facts(grant, don),
    ctx: { don_id, grant_id: grant.id },
  });
  return new Response("", { status: 200 });
}

/**
 * chariot creates the grant before the intent route commits its row, so an
 * event can land first: a young grant's redelivery will find the row, one past
 * the grace is an orphan no redelivery fixes
 */
const RECORDING_GRACE_MS = 60 * 60_000;

function is_young(grant: IGrantRef): boolean {
  const created = grant.createdAt ?? dates_of(grant.statuses)[0];
  // no age to judge by would never age out of redelivery: treat as an orphan
  if (!created) return false;
  return Date.now() - new Date(created).getTime() < RECORDING_GRACE_MS;
}

async function missing_donation(grant: IGrantRef, don_id: string) {
  // unreported: each redelivery would raise one, and the row usually lands
  if (is_young(grant)) {
    console.warn(
      `[chariot webhook] donation ${don_id} not yet recorded for chariot grant ${grant.id}: asking for redelivery`
    );
    return new Response("donation not yet recorded", { status: 409 });
  }
  return ack_unfixable(grant, don_id, {
    message: "chariot grant for a donation that does not exist",
    title: "Chariot Grant Without A Donation",
    detail: `donation ${don_id} not found for chariot grant ${grant.id}`,
    todo: "nothing was changed automatically; no donation records this grant and no receipt went out, so record it by hand",
  });
}

/** the row this grant recorded, or the response answering a delivery that has none */
async function grant_donation(
  grant: IGrantRef,
  don_id: string
): Promise<IDonation | Response> {
  const prior = await donation_get(don_id);
  if (!prior) return missing_donation(grant, don_id);
  // `don_id` rides in connect metadata the browser writes, so it can name any
  // row; the intent route records the grant it made as `via_extra`
  if (prior.via !== "chariot" || prior.via_extra !== grant.id)
    return ack_unfixable(
      grant,
      prior.id,
      {
        message: "chariot grant names a donation it did not record",
        title: "Chariot Grant On Another Donation",
        detail: `chariot grant ${grant.id} names donation ${prior.id}, which is ${prior.via} ${prior.via_extra}`,
        todo: "nothing was changed automatically; this grant is not recorded against any donation, so record it by hand",
      },
      prior
    );
  return prior;
}

/**
 * chariot's fee and its split by `feeType`, in dollars, the parts summing to
 * the fee in cents. `total` and the entries are both optional and unchecked
 * against each other, so the fee is `total` when present, and whatever the
 * entries leave of it goes under `other`
 */
function grant_fees({ id, feeDetail }: Pick<Grant, "id" | "feeDetail">): {
  fee: number;
  fee_parts?: Record<string, number>;
} {
  const raw: Record<string, number> = {};
  let raw_sum = 0;
  for (const { amount, feeType = "other" } of feeDetail?.contributions ?? []) {
    raw[feeType] = (raw[feeType] ?? 0) + amount;
    raw_sum += amount;
  }
  const fee = Math.round(feeDetail?.total ?? raw_sum);
  const keys = Object.keys(raw);
  if (!keys.length) return { fee: fee / 100 };

  const cents: Record<string, number> = {};
  for (const k of keys) cents[k] = Math.round(raw[k]);
  const unbooked = fee - Math.round(raw_sum);
  if (unbooked) {
    console.warn(
      `[chariot webhook] grant ${id} fee entries sum to ${raw_sum} of total ${fee} cents: remainder booked as other`
    );
    cents.other = (cents.other ?? 0) + unbooked;
  }
  // per-part rounding can drift a cent from the fee
  const drift = fee - Object.values(cents).reduce((a, b) => a + b, 0);
  if (drift) {
    const largest = Object.keys(cents).reduce((a, b) =>
      cents[b] > cents[a] ? b : a
    );
    cents[largest] += drift;
  }
  return {
    fee: fee / 100,
    fee_parts: Object.fromEntries(
      Object.entries(cents).map(([k, c]) => [k, c / 100])
    ),
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** compares decoded bytes, so hex case can't decide a match */
function safe_equals(expected: Buffer, received: string): boolean {
  // Buffer.from(hex) stops silently at the first non-hex pair, and
  // timingSafeEqual throws on unequal lengths, so anything but a digest's
  // 64 hex digits is refused before decoding
  if (!SHA256_HEX.test(received)) return false;
  return crypto.timingSafeEqual(expected, Buffer.from(received, "hex"));
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const sig = request.headers.get("chariot-webhook-signature");
    const body = await request.text();

    const parsed = parse_signature(sig ?? "");
    if (!parsed)
      return new Response("malformed signature header", { status: 400 });

    const signed = `${parsed.t}.${body}`;
    const hash = crypto
      .createHmac("sha256", chariot_env.signing_key)
      .update(signed)
      .digest();

    // 4xx, not 2xx: chariot reads 2xx as delivered, so a signing-key mismatch
    // would drop every grant silently; a 4xx is redelivered in production and,
    // after 5 days of failures, flags the subscription `requires_attention`.
    // warn, not report_error: anyone can send a forgery, so each one would
    // raise a report.
    if (!parsed.v1.some((v) => safe_equals(hash, v))) {
      console.warn(
        `[chariot webhook] signature mismatch: t=${parsed.t}, ${parsed.v1.length} v1`
      );
      return new Response("signature mismatch", { status: 401 });
    }

    const payload = JSON.parse(body);
    // https://docs.givechariot.com/api/webhooks
    const category = payload.category ?? "unknown";
    if (payload.associated_object_type !== "grant") {
      console.info(
        `[chariot webhook] ignored: event ${payload.id} ${category} ${payload.associated_object_type}`
      );
      return new Response("", { status: 200 });
    }
    console.info(`[chariot webhook] received: event ${payload.id} ${category}`);
    const grant = await chariot.get_grant(payload.associated_object_id);
    // grant carries donor name, email, phone, address — log ids/status only
    console.info(`[chariot webhook] grant ${grant.id} status ${grant.status}`);
    const meta = (grant.metadata ?? {}) as Partial<ChariotMetadata>;
    // a partner's payment holds its grant id, and that wins over connect
    // metadata, which the partner's page writes and may be absent or junk
    const don_id =
      (await partner_donation_of_grant(db, grant.id)) ??
      (typeof meta.don_id === "string" && meta.don_id ? meta.don_id : null);
    // a young grant may be a partner's whose create call has not written its
    // row yet: a redelivery finds it, so it is asked for rather than lost
    if (!don_id && is_young(grant)) {
      console.warn(
        `[chariot webhook] grant ${grant.id} names no donation yet: asking for redelivery`
      );
      return new Response("donation not yet recorded", { status: 409 });
    }
    // not from our checkout (another connect instance, a dashboard grant):
    // no row can ever match, so a 5xx would only buy ten redeliveries
    if (!don_id) {
      report_error(new Error("chariot grant without a donation id"), {
        grant_id: grant.id,
        status: grant.status,
      });
      return new Response("", { status: 200 });
    }

    if (grant.status === "Canceled") {
      // unlocked read first: the locked one matches `id` only, grant metadata
      // can carry a legacy `id_v1`, and the alert needs the recipient
      const prior = await grant_donation(grant, don_id);
      if (prior instanceof Response) return prior;
      const locked = await db.transaction(async (tx) => {
        const state = await donation_settle_state_locked(tx, prior.id);
        if (!state) return null;
        const op = on_grant_canceled[state.status];
        if (op === "cancel")
          await donation_update(tx, prior.id, { status: "cancelled" });
        return { op, state };
      });
      if (!locked) return missing_donation(grant, prior.id);
      const { op, state } = locked;
      if (op === "alert") {
        await alert_ops({
          message: "chariot grant canceled after settlement",
          title: "Chariot Grant Canceled After Settlement",
          detail: `donation ${prior.id} is ${state.status} but chariot grant ${grant.id} was canceled`,
          facts: grant_facts(grant, prior, state.sttl_id),
          todo: `nothing was changed automatically; ${on_canceled_todo[state.status]}`,
          ctx: { don_id: prior.id, grant_id: grant.id, status: state.status },
        });
        return new Response("", { status: 200 });
      }
      if (op === "keep") {
        console.info(
          `[chariot webhook] donation ${prior.id} is ${state.status}: left unchanged`
        );
        return new Response("", { status: 200 });
      }
      console.info(`[chariot webhook] donation ${prior.id} cancelled`);
      return new Response("", { status: 202 });
    }

    if (grant.status !== "Completed") {
      console.info(`${don_id} status:${grant.status}`);
      // avoid retry
      return new Response("", { status: 203 });
    }

    const gross = grant.amount / 100;
    const { fee, fee_parts } = grant_fees(grant);

    const completed_at =
      dates_of(grant.statuses?.filter((x) => x.status === "Completed")).at(
        -1
      ) ?? grant.updatedAt;

    const settlement: ISettlement = {
      date: new Date(completed_at ?? Date.now()).toISOString(),
      net: gross - fee,
      fee,
      ...(fee_parts && { fee_parts }),
      id: grant.id,
      currency: "USD",
    };

    const prior = await grant_donation(grant, don_id);
    if (prior instanceof Response) return prior;
    const locked = await db.transaction(async (tx) => {
      const state = await donation_settle_state_locked(tx, prior.id);
      if (!state) return null;
      const op = on_grant_completed[state.status];
      if (op !== "settle") return { op, state };
      const result = calc_donation_settle({
        kind: "one-time",
        order_id: prior.id,
        prior: { ...prior, status: state.status },
        settlement,
      });
      if (result.op !== "update")
        throw new Error(`unexpected ${result.op} for chariot one-time`);
      await donation_update(tx, result.order_id, result.patch);
      return { op, state, msgs: result.msgs };
    });

    if (!locked) return missing_donation(grant, prior.id);
    if (locked.op === "settle") {
      await enqueue(...locked.msgs);
      return Response.json({ id: prior.id });
    }

    if (locked.op === "alert") {
      await alert_ops({
        message: "chariot grant completed after cancel",
        title: "Chariot Grant Completed After Cancel",
        detail: `donation ${prior.id} is cancelled but chariot grant ${grant.id} completed`,
        facts: `${grant_facts(grant, prior)}, net ${settlement.net.toFixed(2)} USD, fee ${settlement.fee.toFixed(2)} USD`,
        todo: "nothing was settled automatically; confirm the payout in chariot's dashboard before settling it by hand",
        ctx: {
          don_id: prior.id,
          grant_id: grant.id,
          status: locked.state.status,
        },
      });
      return new Response("", { status: 200 });
    }
    const { sttl_id } = locked.state;
    if (locked.state.status === "settled" && !sttl_id)
      return ack_unfixable(
        grant,
        prior.id,
        {
          message: "chariot donation settled without a settlement",
          title: "Chariot Donation Settled Without A Settlement",
          detail: `donation ${prior.id} is settled with no settlement, and chariot grant ${grant.id} completed`,
          todo: "nothing was settled or re-sent automatically; attach this grant's settlement to the donation by hand",
        },
        prior
      );
    if (sttl_id && sttl_id !== grant.id) {
      await alert_ops({
        message: "chariot grant completed on a donation another grant settled",
        title: "Chariot Grant Completed On A Settled Donation",
        detail: `donation ${prior.id} is ${locked.state.status} by settlement ${sttl_id} but chariot grant ${grant.id} also completed`,
        facts: grant_facts(grant, prior, sttl_id),
        todo: "nothing was settled or re-sent automatically; this grant's payout is not recorded against any donation",
        ctx: {
          don_id: prior.id,
          grant_id: grant.id,
          sttl_id,
          status: locked.state.status,
        },
      });
      return new Response("", { status: 200 });
    }
    // duplicate, acked 2xx so chariot stops redelivering: a reversed row gets
    // nothing re-sent; a row read unsettled and settled under the lock is the
    // concurrent delivery's to enqueue
    if (locked.state.status === "settled" && prior.settlement)
      await requeue({ ...prior, settlement: prior.settlement });
    console.info(
      `[chariot webhook] donation ${prior.id} is ${locked.state.status}: left unchanged`
    );
    return new Response("", { status: 200 });
  } catch (err) {
    return report_resp(err, "something went wrong");
  }
}
