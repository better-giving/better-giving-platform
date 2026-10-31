import type {
  IDonation,
  IDonationSettled,
  TDonationSource,
} from "../donations";
import type { IReg } from "../reg/schema";
import type { TFrequency } from "../schemas";
import type { Alert } from "../slack";
import type { ISub } from "../subscriptions";
import type { IDelivery, IMsg } from "./types";

interface IFromAddress {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}

// dedupe keys ship to qstash and gate at-most-once delivery. change one only
// when no enqueue can repeat across the deploy: a repeat under the new string
// isn't deduped against the old.

/** receive-only: see its `dedupe` entry */
export interface IDonFundReceiptPayload {
  id: string;
  attempt?: number;
}

export interface IFiatNoticePayload {
  /** stable per notice (e.g. the webhook event id plus its outcome), so a
   * repeat enqueue of the same notice is one message and a different one is not */
  id: string;
  alert: Alert;
}

export interface IDonDistPayload {
  id: string;
  date_created: string;
  amount: number;
  amount_usd: number;
  amount_denom: string;
  frequency: TFrequency;
  via: string;
  source: TDonationSource | (string & {});
  to_id: number;
  to_name: string;
  net: number;
  sttl_date: string;
  from_email: string;
  from?: { name?: string; company?: string; address?: IFromAddress };
  program?: { id: string; name: string };
  form?: { id: string; tag?: string };
}

/** the stripe transfer owed to a routed dist. figures and destination are
 * read off the dist row at send time, never carried here */
export interface IConnectTransferPayload {
  dist_id: string;
  /** the dist's donation: the transfer's metadata, and what it is reported under */
  donation_id: string;
  /** the payment intent the donation settled on; its charge funds the transfer */
  intent_id: string;
  /** the dispute whose close released the transfer it held: a message of its
   * own, past the dedupe of the settlement's send */
  release?: string;
}

export interface IDonMatchPayload {
  /** donation the match event attaches to */
  id: string;
  /** employer as the donor typed it — echoed back in the pack, never resolved */
  from_company_name: string;
}

export interface IDonMatchChasePayload {
  /**
   * donation the chase is about — and, by itself, the event it is about:
   * `donation_id` is unique on the event table, so there is nothing else to
   * name. no token and no event id ride along because nothing carried here
   * would still be trustworthy on arrival — days pass between arming and
   * delivery, and the handler re-reads the donation and the event at fire time
   * rather than believing a payload written before the donor had a chance to
   * file.
   */
  id: string;
}

export interface IOwedNoticePayload {
  /** the `owed_notices` row; the handler reads everything else at send time */
  id: string;
}

export interface IBankingPayload {
  npo_id: number;
  bank_summary?: string;
  rejection_reason?: string;
}

export interface IFundMemberRemovedPayload {
  fund_id: string;
  creator_id: string;
  creator_name: string;
  npo_id: number;
  /** receive-only: the pre-`npo_id` shape, still reachable from a retry or the dlq */
  removed_npo_ids?: number[];
}

export interface IInviteEmailPayload {
  invitee: string;
  invitee_first_name: string;
  invitor: string;
  npo_id: number;
  npo_name: string;
  /** iso, when the producer sent it, so each re-invite keys apart */
  sent_at: string;
}

export interface ILockTxCreatedPayload {
  npo_id: number;
  account: string;
  account_other: string;
  bal_begin: string | number;
  bal_end: string | number;
  amount: string | number;
  date_created: string | Date;
}

export interface IPaypalOrderCapturePayload {
  order_id: string;
  don_id: string;
  /** iso, when the check was scheduled. the handler reads a message without
   * one as a retry */
  scheduled_at?: string;
}

/** how long the fallback capture holds before its first attempt */
export const PAYPAL_CAPTURE_DELAY_S = 5 * 60;

export interface IRegCreatedPayload {
  id: string;
  r_id: string;
  /** the producer could not establish that whoever started this application
   * owns `r_id` — the lead form, where the poster is a stranger to the address. */
  unproven: boolean;
}

interface ISubDeactivatedBase {
  id: string;
  platform: string;
  status_cancel_reason?: string | null;
}

/** the refund and stripe-webhook cancels */
interface ISubDeactivatedOther extends ISubDeactivatedBase {
  by_donor?: false;
}

/** the donor's own cancel, which told them it went through */
interface ISubDeactivatedByDonor extends ISubDeactivatedBase {
  by_donor: true;
  /** when the donor asked, so each donor cancel keys apart */
  cancel_requested_at: string;
}

export type ISubDeactivatedPayload =
  | ISubDeactivatedOther
  | ISubDeactivatedByDonor;

/** the donor's refused cancel, after its row was restored to active */
export interface ISubCancelFailedEmailPayload
  extends Pick<
    ISub,
    | "id"
    | "to_name"
    | "amount"
    | "amount_usd"
    | "currency"
    | "interval"
    | "interval_count"
  > {
  /** the donor's email */
  to: string;
  /** the refused cancel's `cancel_requested_at` */
  cancelled_at: string;
}

export interface ITipReceivedPayload {
  id: string;
  date: string;
  npo_name: string;
  npo_id: number;
  is_recurring: boolean;
  type_tip: {
    input: number;
    denom: string;
    input_usd: number;
  };
}

export type Payloads = {
  "banking-approved": IBankingPayload;
  "banking-default": IBankingPayload;
  "banking-new": IBankingPayload;
  "banking-rejected": IBankingPayload;
  "connect-transfer": IConnectTransferPayload;
  "don-dist": IDonDistPayload;
  "don-fund-receipt": IDonFundReceiptPayload;
  "don-match": IDonMatchPayload;
  "don-match-chase": IDonMatchChasePayload;
  "don-sttl-dist": IDonationSettled;
  "don-sttl-receipt": IDonation;
  "fiat-notice": IFiatNoticePayload;
  "fund-member-removed": IFundMemberRemovedPayload;
  "invite-email": IInviteEmailPayload;
  "lock-tx-created": ILockTxCreatedPayload;
  "owed-notice": IOwedNoticePayload;
  "paypal-order-capture": IPaypalOrderCapturePayload;
  "reg-created": IRegCreatedPayload;
  "reg-updated": IReg;
  "sub-cancel-failed-email": ISubCancelFailedEmailPayload;
  "sub-deactivated": ISubDeactivatedPayload;
  "tip-received": ITipReceivedPayload;
};

export type Kind = keyof Payloads;

// producer input types. for most kinds this is just Payloads[K]; reg-updated
// takes a drizzle row (string | null fields don't satisfy IReg's
// string | undefined), and names the two fields its dedupe key reads so a
// projection of the row can't stand in for it. wire payload is the full row;
// the consumer narrows back to IReg.
export type MsgInput<K extends Kind> = K extends "reg-updated"
  ? {
      id: string | number;
      status: IReg["status"] | null;
      updated_at: string | null;
    }
  : Payloads[K];

/** what the queue says about this delivery */
export interface IAttempt {
  /** no retry follows if this one throws */
  last: boolean;
}

export type Handlers = {
  [K in Kind]: (payload: Payloads[K], attempt: IAttempt) => Promise<unknown>;
};

const dedupe: { [K in Kind]: (p: Payloads[K]) => string } = {
  "banking-approved": (p) => `banking.approved_${p.npo_id}`,
  "banking-default": (p) => `banking.default_${p.npo_id}`,
  "banking-new": (p) => `banking.new_${p.npo_id}`,
  "banking-rejected": (p) => `banking.rejected_${p.npo_id}`,
  "connect-transfer": (p) =>
    `connect.transfer_${p.dist_id}${p.release ? `_${p.release}` : ""}`,
  "don-dist": (p) => `don.dist_${p.id}_${p.to_id}`,
  // receive-only, and so no delivery entry: nothing sends it. kept so a wait
  // scheduled by the build that made fund receipts wait on their split still
  // has a handler; remove once none can be in flight.
  "don-fund-receipt": (p) => `don.fund-receipt_${p.id}_${p.attempt ?? 0}`,
  "don-match": (p) => `don.match_${p.id}`,
  "don-match-chase": (p) => `don.match-chase_${p.id}`,
  "don-sttl-dist": (p) => `don.sttl-dist_${p.id}`,
  "don-sttl-receipt": (p) => `don.sttl-receipt_${p.id}`,
  "fiat-notice": (p) => `fiat.notice_${p.id}`,
  "fund-member-removed": (p) =>
    `fund.removed_${p.fund_id}_${p.creator_id}_${p.npo_id}`,
  // one per send: a re-invite is its own mail (it refreshes a pending invite's
  // expiry), and so is a second nonprofit's invite to the same person
  "invite-email": (p) =>
    `invite_${p.invitee}_${p.npo_id}_${p.sent_at.replace(/:/g, "")}`,
  "lock-tx-created": (p) =>
    `lock_tx_${p.npo_id}_${String(p.date_created).replace(/:/g, "")}`,
  "owed-notice": (p) => `owed.notice_${p.id}`,
  "paypal-order-capture": (p) => `paypal.order-capture_${p.order_id}`,
  "reg-created": (p) => `reg.created_${p.id}`,
  // one key per row state: every write stamps updated_at, so a new save is a
  // new key and a repeat enqueue of the same row is not.
  "reg-updated": (p) =>
    `reg.updated_${p.id}_${p.status}_${String(p.updated_at).replace(/:/g, "")}`,
  // per refused cancel: a later cancel that is refused too mails again
  "sub-cancel-failed-email": (p) =>
    `sub.cancel-failed-email_${p.id}_${p.cancelled_at.replace(/:/g, "")}`,
  // one per donor cancel: a second cancel after a refused one must reach the
  // provider rather than dedupe against the first
  "sub-deactivated": (p) =>
    p.by_donor
      ? `sub.deactivated_${p.id}_${p.cancel_requested_at.replace(/:/g, "")}`
      : `sub.deactivated_${p.id}`,
  "tip-received": (p) => `tip_${p.id}`,
};

// per-kind delivery config. a kind absent here keeps at-most-once,
// deliver-now delivery; scheduled follow-ups take a delay.
//
// every kind whose handler only reads and mails takes retries, and the trade is
// the same one for all of them: a duplicate notification costs a reader one
// confused minute, while a lost one is a mail nobody knows is missing. that
// only holds because those handlers mail through `send_email_or_throw` — the
// swallowing `send_email` returns normally on a refusal, which tells qstash the
// mail is away and burns the retry on nothing.
//
// a kind stays absent when its handler does non-idempotent work a redelivery
// would repeat — `reg-updated`, which keeps the swallowing send and carries
// its own reasoning at the handler.
const delivery: Partial<{ [K in Kind]: IDelivery }> = {
  "banking-approved": { retries: 3 },
  "banking-default": { retries: 3 },
  "banking-new": { retries: 3 },
  "banking-rejected": { retries: 3 },
  // a redelivery never pays twice: one finding the transfer stored only
  // reverses the refunds that came before it (which can throw and retry), and
  // one before the store reaches stripe on the same idempotency key. the last
  // attempt of a transfer stripe never answered tells ops
  "connect-transfer": { retries: 3 },
  // the lease in `handle-don-receipt` is what makes this safe past the first
  // mail: a redelivery that finds the claim taken returns without sending, and
  // one that finds the sent stamp never mails a second tax receipt.
  "don-sttl-receipt": { retries: 3 },
  // the dist's notice lease (`claim_dist_notice`) answers a redelivery after
  // the notice is sent with a 200, and one that finds another holder's claim
  // inside the 15 min lease with a throw. a holder that dies keeps its claim
  // until the lease expires, and on the default backoff only retries 3 (~33
  // min) and 4 (~6.7 h) land after it — 4, so recovery has two attempts.
  "don-dist": { retries: 4 },
  // an instruction to ops that has no other record once the work behind it is
  // done. `send_alert` throws on a refused post, as `send_email_or_throw` does.
  "fiat-notice": { retries: 3 },
  "fund-member-removed": { retries: 3 },
  "invite-email": { retries: 3 },
  "lock-tx-created": { retries: 3 },
  // the handler acks a notice already sent or held under another's lease; a
  // notice still unsent past its lease is enqueued again by the owed-notices
  // cron, so these retries only have to cover a failed send
  "owed-notice": { retries: 3 },
  // only the welcome mail; registration's update side is `reg-updated`.
  "reg-created": { retries: 3 },
  "sub-cancel-failed-email": { retries: 3 },
  "tip-received": { retries: 3 },
  // a lost cancel keeps charging a donor who cancelled. a stripe repeat is
  // harmless: handle_sub_deactivated reads the live sub first and returns on
  // one already ended.
  "sub-deactivated": { retries: 3 },
  // this handler reads the donation and writes an event row before it mails
  // anything, so its failure modes are transient db ones rather than duplicate
  // sends — and the pack send is gated by a claim query, so a retry of a
  // delivery that already sent loses the claim and returns without mailing. a
  // transient failure must not be what costs a donor their match.
  "don-match": { retries: 3 },
  // the one reminder to file. three days is long enough that the pack has
  // dropped out of view and short enough to still land inside most filing
  // windows. a delay this long cannot ride the FIFO queue — it would sit at the
  // head of it for three days with every other notification stuck behind — so
  // this kind must be sent through `schedule` in `.server/kit/queue.ts`, never
  // `enqueue`.
  "don-match-chase": { delay_s: 3 * 24 * 60 * 60 },
  // the fallback capture for an approval whose browser never captured. held
  // past the browser's own capture so the two don't race under one request
  // id; the handler re-reads the order and captures only one still APPROVED.
  // sent through `schedule`, like the chase. the donor has left by now, so these
  // retries are the only thing that captures through a paypal or db outage:
  // five on qstash's default backoff span ~31h, and a retry past the order's
  // expiry reads a 404 and returns.
  "paypal-order-capture": { delay_s: PAYPAL_CAPTURE_DELAY_S, retries: 5 },
};

export const msg = <K extends Kind>(kind: K, payload: MsgInput<K>): IMsg => ({
  id: kind,
  payload,
  dedupe: (dedupe[kind] as (p: MsgInput<K>) => string)(payload),
  ...delivery[kind],
});

/** the retries a kind is delivered with; 0 when it's at-most-once */
export const retries_of = (kind: Kind): number => delivery[kind]?.retries ?? 0;

// runtime enumeration of every Kind, sourced from the dedupe map (which is
// itself exhaustiveness-enforced by `{ [K in Kind]: ... }`). use in tests
// instead of hand-maintained kind lists.
export const KINDS = Object.keys(dedupe) as Kind[];
