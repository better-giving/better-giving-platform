import { eq } from "drizzle-orm";
import { db } from "../pg/db";
import {
  dispute_close,
  dispute_get,
  dispute_open,
  dispute_record_share,
  type IDispute,
} from "../pg/queries/dispute";
import type { DbOrTx } from "../pg/queries/helpers";
import { type IOwed, owed_for_donation, owed_total } from "../pg/queries/owed";
import { take_undo, takes_of } from "../pg/queries/take";
import { donation_disputes } from "../pg/schema/dispute";
import { dists } from "../pg/schema/dist";
import { load_reversible, type Rail, type Unreversible } from "./reverse";
import {
  fraction_of,
  gift_dists_locked,
  type LockedDist,
  type Share,
  settled_dists_locked,
} from "./share";
import { dispute_take, move_owed, take_dispute, taken_of } from "./takes";

export interface DisputeOpened {
  donation_id: string;
  rail: Rail;
  /** the provider's dispute id: the dispute's record, and what the owed rows
   * it writes answer to */
  dispute_id: string;
  /** when the provider opened it */
  opened_at: string;
  /** the dispute's own part of the charge, nothing else: what the open adds
   * to what the gift has on record as taken back, and what a win of it
   * credits back. one that can't be sized claims a chargeback recorded
   * before it, else is the rest of the charge: the open owes as much as it
   * can, and a win credits it all back */
  disputed: Share;
  /** what the provider charged for the dispute, in usd; 0 when none */
  fee_usd: number;
}

export type DisputeOpenedResult =
  /** `owed`: each party's row as it stands. `inserted`: this call put the
   * dispute on record, which at most one call per dispute does — none when
   * a record-only open or a close wrote it first. `owed_written`: this call
   * grew what a row owes — an inquiry's escalation on record included; never
   * a redelivery, nor a second dispute that adds nothing. `prior_refs`: the
   * other disputes whose rows this one found and merged into, the first
   * one's ref standing — a second dispute on one payment adds to a row only
   * what the first left uncounted, and a win of it credits its own share */
  | {
      status: "recorded";
      owed: IOwed[];
      inserted: boolean;
      owed_written: boolean;
      prior_refs: string[];
    }
  /** the dispute was already recorded closed: nothing written */
  | {
      status: "closed";
      dispute_status: Exclude<IDispute["status"], "open">;
      inserted: false;
    }
  /** the dispute is on record, and the gift owes nothing more */
  | (Extract<Unreversible, { status: "already_reversed" }> & {
      inserted: boolean;
    })
  | Extract<Unreversible, { status: "failed" }>;

/**
 * a chargeback opened on a gift: records the dispute, puts its own part on
 * the gift's ledger of takes (claiming a chargeback of it recorded before the
 * filing), and moves what each party owes by the difference that makes: see
 * `owed_targets`. the gift stays settled until the dispute closes.
 *
 * safe to rerun: a redelivery records nothing new, and an open handled
 * after the dispute's close (providers don't order their events) none at all.
 */
export async function dispute_opened(
  d: DisputeOpened
): Promise<DisputeOpenedResult> {
  const loaded = await load_reversible(d.donation_id, d.rail);
  if (loaded.status === "failed") return loaded;
  const { don } = loaded;
  const record = {
    id: d.dispute_id,
    donation_id: don.id,
    opened_at: d.opened_at,
  };
  if (loaded.status === "already_reversed") {
    const { inserted } = await dispute_open(db, record);
    const { status, donation_status } = loaded;
    return { status, donation_status, inserted };
  }
  const now = new Date().toISOString();

  return db.transaction(async (tx): Promise<DisputeOpenedResult> => {
    const { status, inserted } = await dispute_open(tx, record);
    if (status !== "open") {
      return { status: "closed", dispute_status: status, inserted: false };
    }
    const ds = await settled_dists_locked(tx, don.id);
    const was = new Map(
      (await owed_for_donation(don.id, tx)).map((o) => [o.id, owed_total(o)])
    );
    const before = await takes_of(tx, don.id);
    await take_dispute(tx, {
      donation_id: don.id,
      dispute_id: d.dispute_id,
      share: fraction_of(d.disputed),
      fee_usd: d.fee_usd,
      opened_at: d.opened_at,
    });
    const after = await takes_of(tx, don.id);
    const moves = await move_owed(tx, {
      donation_id: don.id,
      ds,
      before,
      after,
      src: { source: "dispute", source_ref: d.dispute_id },
      now,
    });
    const rows = moves.flatMap((m) => (m.row ? [m.row] : []));
    const take = after.find((t) => t.ref === d.dispute_id);
    if (take) {
      await dispute_record_share(tx, d.dispute_id, {
        share: take.share,
        cumulative_share: Math.max(taken_of(after), take.share),
        fee_usd: take.fee_usd,
      });
    }
    const prior_refs = [
      ...new Set(
        rows
          .filter(
            (o) => o.source === "dispute" && o.source_ref !== d.dispute_id
          )
          .map((o) => o.source_ref)
      ),
    ];
    const owed_written = rows.some((o) => owed_total(o) > (was.get(o.id) ?? 0));
    return {
      status: "recorded",
      owed: rows,
      inserted,
      owed_written,
      prior_refs,
    };
  });
}

export interface DisputeWon {
  donation_id: string;
  rail: Rail;
  /** the provider's dispute id */
  dispute_id: string;
  /** how it closed without the buyer keeping the money from the gift: won,
   * a claim accepted that a refund pays, or an inquiry closed; `won` absent */
  status?: "won" | "accepted" | "inquiry_closed";
  /** the dispute's own part of the charge, when the provider states it:
   * finds a chargeback of it recorded before its filing was, as a filing
   * does. absent or unsized, the oldest such chargeback. only a win claims
   * one: a refund pays an accepted claim, an inquiry withdraws nothing, and
   * paypal's NONE leaves any chargeback to the dispute that superseded it */
  disputed?: Share;
  /** when the provider opened it: records the dispute if its open never was */
  opened_at: string;
  closed_at: string;
}

export type DisputeWonResult =
  /** each row the dispute recorded, credited */
  | { status: "credited"; owed: IOwed[] }
  /** the dispute is on record won, and this call credits nothing new.
   * `prior_status`: its record before this win, null when there was none.
   * `credited`: this dispute's loss reversed the gift and its take is
   * undone, this call's or a replay's. a loss that only closed the row,
   * or a gift a refund or another dispute reversed, is not.
   * `hand`: an older loss reversed the gift before that was stamped, so
   * nothing here credits it and ops restores it. false when the reversal
   * source is a refund or another dispute */
  | (Extract<Unreversible, { status: "already_reversed" }> & {
      prior_status: IDispute["status"] | null;
      credited: boolean;
      hand: boolean;
    })
  /** the dispute was closed otherwise first, `prior_status` (a win on appeal
   * of a loss that left the gift settled): the first close stands, so
   * nothing is credited, and what it owes stays for ops to settle by hand */
  | { status: "conflict"; prior_status: IDispute["status"] }
  | Extract<Unreversible, { status: "failed" }>;

/**
 * a chargeback closed in the gift's favour, or that no longer counts (a claim
 * accepted, which its refund pays; an inquiry closed): its take is undone, so
 * each party's row is credited back what the takes owed with it less what
 * they owe without it, its dispute fee included, whatever else wrote the row.
 * what was already recovered from a party's grants is then due back to it.
 *
 * safe to rerun: a redelivery credits nothing new.
 */
export async function dispute_won(d: DisputeWon): Promise<DisputeWonResult> {
  const loaded = await load_reversible(d.donation_id, d.rail);
  if (loaded.status === "failed") return loaded;
  const { don } = loaded;
  const record = {
    id: d.dispute_id,
    donation_id: don.id,
    status: d.status ?? "won",
    opened_at: d.opened_at,
    closed_at: d.closed_at,
  };
  if (loaded.status === "already_reversed") {
    // read before the close, which turns an open record won
    const prior = await dispute_get(d.dispute_id);
    await dispute_close(db, record);
    const { status, donation_status } = loaded;
    const prior_status = prior?.status ?? null;
    // the stamp is this dispute's own reversal, written with the gift's
    // flip. a lost row without it was closed on a gift a refund or another
    // dispute reversed, unless the row is older than the stamp: that loss
    // still reversed the gift, and ops restores it. paypal stays a hand
    // restore of its own, outside this credit
    const stamped =
      prior_status === "lost" &&
      d.rail === "stripe" &&
      prior?.loss_recorded_at != null;
    const credited = stamped && (await credit_reversed_loss(don.id, d));
    const hand =
      !credited &&
      prior_status === "lost" &&
      d.rail === "stripe" &&
      prior != null &&
      (await older_loss_needs_hand(don.id, d.dispute_id, prior));
    return { status, donation_status, prior_status, credited, hand };
  }
  const now = new Date().toISOString();

  return db.transaction(async (tx): Promise<DisputeWonResult> => {
    const stands = await dispute_close(tx, record);
    if (stands !== record.status) {
      return { status: "conflict", prior_status: stands };
    }
    const ds = await settled_dists_locked(tx, don.id);
    const { owed } = await credit_won_take(tx, don.id, d, ds, now);
    return { status: "credited", owed };
  });
}

/** the win's credit: undo its take and move each party's row by what that
 * drops, the same reasons a settled win books. `settled` is the take
 * undone, including a redelivery's, which credits nothing more */
async function credit_won_take(
  tx: DbOrTx,
  donation_id: string,
  d: DisputeWon,
  ds: LockedDist[],
  now: string
): Promise<{ owed: IOwed[]; settled: boolean }> {
  const before = await takes_of(tx, donation_id);
  const take = await dispute_take(tx, {
    donation_id,
    dispute_id: d.dispute_id,
    share: d.disputed ? fraction_of(d.disputed) : null,
    claims: (d.status ?? "won") === "won",
  });
  // none on record. undone already: a redelivery, or the refund that paid
  // an accepted claim. `settled` is the take undone, so a replay reports
  // the same credit the first call booked
  if (!take) return { owed: [], settled: false };
  if (!(await take_undo(tx, donation_id, take.ref))) {
    return { owed: [], settled: true };
  }
  const after = await takes_of(tx, donation_id);
  const moves = await move_owed(tx, {
    donation_id,
    ds,
    before,
    after,
    src: { source: "dispute", source_ref: d.dispute_id },
    now,
  });
  return {
    owed: moves.flatMap((m) => (m.row ? [m.row] : [])),
    settled: true,
  };
}

/** a loss reversed the dists, so they are no longer settled. two facts the
 * reversal wrote would price a later credit off the wrong gift: a pending
 * payout it cancelled is `refunded`, which reads as a grant that went out,
 * and a commission it marked `refunded_loss` counts as paid only when a
 * transfer had claimed it (`ref`). a pending commission was never owed */
const still_owed = (ds: LockedDist[]): LockedDist[] =>
  ds.map((dist) => {
    const commission = dist.commission;
    const payout_type =
      dist.payout_type === "refunded" ? "pending" : dist.payout_type;
    const claimed =
      commission?.status === "refunded_loss" && commission.ref != null;
    if (payout_type === dist.payout_type && !claimed) return dist;
    return {
      ...dist,
      payout_type,
      commission:
        claimed && commission
          ? { ...commission, status: "paid" as const }
          : commission,
    };
  });

/** a full loss from before `loss_recorded_at` was written. its take is still
 * active — a refund of the same part would have undone it — the gift is
 * reversed, and this dispute still holds what it recorded as owed. a
 * partial loss records a cumulative share under 1 and does not flip the
 * gift, so a later refund's reversal is not this dispute's to restore */
async function older_loss_needs_hand(
  donation_id: string,
  dispute_id: string,
  prior: IDispute
): Promise<boolean> {
  const takes = await takes_of(db, donation_id);
  const take = takes.find(
    (t) =>
      t.kind === "dispute" &&
      (t.ref === dispute_id || t.dispute_id === dispute_id)
  );
  if (take?.status !== "active") return false;
  const covered = prior.cumulative_share ?? take.share;
  if (covered < 1) return false;
  const rows = await db
    .select({
      status: dists.status,
      refund_status: dists.refund_status,
    })
    .from(dists)
    .where(eq(dists.donation_id, donation_id));
  const reversed =
    rows.length > 0 &&
    rows.every(
      (d) =>
        d.status !== "settled" ||
        d.refund_status === "completed" ||
        d.refund_status === "loss"
    );
  if (!reversed) return false;
  // another dispute on this gift already stamped its own reversal. this
  // unstamped loss only closed the row, and that other win credits the debt
  const siblings = await db
    .select({
      id: donation_disputes.id,
      loss_recorded_at: donation_disputes.loss_recorded_at,
    })
    .from(donation_disputes)
    .where(eq(donation_disputes.donation_id, donation_id));
  if (siblings.some((s) => s.id !== dispute_id && s.loss_recorded_at != null)) {
    return false;
  }
  const owed = await owed_for_donation(donation_id);
  return owed.some(
    (o) =>
      o.source === "dispute" &&
      o.source_ref === dispute_id &&
      (o.outstanding_usd ?? 0) > 0
  );
}

/** the stripe credit for a win after this dispute's loss reversed the gift.
 * the loss's take is undone and each party is credited what it owed with
 * that take: received, card fee and dispute fee. a replay undoes nothing */
async function credit_reversed_loss(
  donation_id: string,
  d: DisputeWon
): Promise<boolean> {
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    const ds = still_owed(await gift_dists_locked(tx, donation_id));
    const { settled } = await credit_won_take(tx, donation_id, d, ds, now);
    return settled;
  });
}
