import { normalize_employer } from "../match";
import { msg } from "../queue";
import type { IMsg } from "../queue/types";
import type {
  IDonation,
  IDonationSettled,
  IDonationUpdate,
  ISettlement,
} from "./interfaces";

interface CommonInputs {
  order_id: string;
  settlement: ISettlement;
  via?: string;
}

export type SettleInputs =
  | (CommonInputs & {
      kind: "one-time";
      prior: IDonation;
    })
  | (CommonInputs & {
      kind: "first-recurring";
      prior: IDonation;
      subs_id: string;
    })
  | (CommonInputs & {
      kind: "rebill";
      prior: IDonationSettled;
      subs_id: string;
      new_id: string;
    })
  | (CommonInputs & {
      /** another deposit to an already-used address, settled apart from its order */
      kind: "redeposit";
      prior: IDonation;
      new_id: string;
    });

export type SettleResult =
  | {
      op: "update";
      order_id: string;
      patch: IDonationUpdate;
      msgs: IMsg[];
    }
  | {
      op: "put";
      row: IDonationSettled;
      msgs: IMsg[];
    }
  | {
      op: "noop";
      order_id: string;
      msgs: IMsg[];
    };

/** statuses that mean the money went back — settling over one, or mailing its receipt, is never right */
export const reversed_statuses = [
  "refunded",
  "refunded_loss",
] as const satisfies readonly IDonation["status"][];
const reversed = new Set<IDonation["status"]>(reversed_statuses);

/**
 * has a refund already taken this donation's money back?
 *
 * the same test `calc_donation_settle` applies before it writes, exported for
 * the recovery path a provider handler's idempotency guard sends down: that
 * path never reaches `calc_donation_settle`, so without this it would recompute
 * a dist and a receipt for a gift the donor was already refunded.
 */
export function is_reversed(status: IDonation["status"]): boolean {
  return reversed.has(status);
}

/**
 * was this donation recorded twice and its duplicate cancelled? the duplicate's
 * dist reads `refunded`, but no refund was made. a cancelled donation with no
 * dist (a canceled DAF grant, a checkout a campaign close shut) or with a
 * `refunded_loss` dist (money did go back) is not one
 */
export function is_cancelled_duplicate(
  donation_status: string,
  dist_status: string | null | undefined
): boolean {
  return donation_status === "cancelled" && dist_status === "refunded";
}

/**
 * the queue messages a settled donation row produces.
 *
 * one definition, two callers: `calc_donation_settle` below computes them for
 * the row it is about to write, and a provider handler whose idempotency guard
 * fired computes them again for the row a previous delivery already wrote —
 * the enqueue happens after the commit, so a delivery can leave a settled
 * donation whose msgs never went out, and the redelivery is the only thing
 * left that can send them. every kind here but the dist absorbs a duplicate
 * downstream, so re-sending is cheap and dropping is not. the dist is absorbed
 * per destination only: a fund's split is recomputed on each run, so a member
 * activated since the first run gets a fresh share.
 *
 * `match` is the caller's call rather than something read off the row: it is
 * false for a rebill and true for the charge that opened the subscription, and
 * nothing on the row itself distinguishes the two.
 */
export function settle_msgs(
  row: IDonationSettled,
  opts: { match: boolean }
): IMsg[] {
  const msgs: IMsg[] = [
    msg("don-sttl-dist", row),
    msg("don-sttl-receipt", row),
  ];
  if (!opts.match) return msgs;

  // normalized only to decide whether a name was given at all: input that is
  // punctuation alone leaves nothing to address a pack about, so it never
  // becomes a queued message. junk that survives ("n/a") is left alone — the
  // pack is addressed to the donor and asserts nothing about the employer, so
  // the worst case is one email that names a company nobody works for.
  const employer = row.from_company_name ?? "";
  if (normalize_employer(employer)) {
    msgs.push(msg("don-match", { id: row.id, from_company_name: employer }));
  }
  return msgs;
}

/**
 * decide the donation-row write + queue messages that result from a
 * provider settle event. callers project provider-specific event shapes
 * into `SettleInputs`, then dispatch on the returned `op` to write and
 * enqueue. msgs are precomputed from the projected post-write donation.
 */
export function calc_donation_settle(i: SettleInputs): SettleResult {
  if (i.kind === "rebill" || i.kind === "redeposit") {
    const row: IDonationSettled = {
      ...i.prior,
      id: i.new_id,
      id_v1: undefined,
      // the clone carries its own outcome, never the order row's. a refunded
      // first charge does not make this month's cleared charge refunded, and a
      // row that says so while still distributing has the donation and the
      // dist disagreeing about the same money.
      status: "settled",
      created_at: i.settlement.date,
      updated_at: i.settlement.date,
      settlement: i.settlement,
      ...(i.kind === "rebill" ? { subscription_id: i.subs_id } : {}),
      ...(i.via ? { via: i.via } : {}),
    };
    return {
      op: "put",
      row,
      // no don-match: rebills are deliberately excluded from employer matching
      // (v1 policy — no monthly filing packs for subscribers). the first charge
      // of the subscription already produced one, as the order row of a
      // redeposit did.
      msgs: settle_msgs(row, { match: false }),
    };
  }

  // a redelivered settle event lands on the donation the refund already
  // reversed. writing "settled" over it would contradict the dist row, which
  // stays "refunded", and re-mail a receipt for money the donor got back.
  // rebills and redeposits are exempt: their prior is the order row, not the
  // row being settled, so its status says nothing about the charge that just
  // cleared.
  if (is_reversed(i.prior.status)) {
    return { op: "noop", order_id: i.order_id, msgs: [] };
  }

  const patch: IDonationUpdate = {
    status: "settled",
    settlement: i.settlement,
    ...(i.via ? { via: i.via } : {}),
    ...(i.kind === "first-recurring" ? { subscription_id: i.subs_id } : {}),
  };
  // settlement is always set above, so the merged row is IDonationSettled.
  const projected = { ...i.prior, ...patch } as IDonationSettled;

  return {
    op: "update",
    order_id: i.order_id,
    patch,
    msgs: settle_msgs(projected, { match: true }),
  };
}
