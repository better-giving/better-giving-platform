import { inArray } from "drizzle-orm";
import { report_error } from "#/errors/report";
import { db } from "../pg/db";
import { dispute_get } from "../pg/queries/dispute";
import type { DbOrTx } from "../pg/queries/helpers";
import {
  type IOwed,
  type OwedParty,
  owed_for_party,
  record_owed,
} from "../pg/queries/owed";
import { refund_failed_ref } from "../pg/queries/owed-refund";
import {
  type ITake,
  take_add,
  take_undo,
  take_update,
  takes_of,
} from "../pg/queries/take";
import { dists } from "../pg/schema/dist";
import type { OwedSource } from "./apply";
import { dist_settled_usd, past_cut } from "./plan";
import {
  type CreditPart,
  credit_parts,
  gift_dists_locked,
  grant_went_out,
  type LockedDist,
  type OwedShare,
  owed_shares,
  settled_dists_locked,
  split_cents,
} from "./share";

const active = (t: ITake) => t.status === "active";
const same_share = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** how much of the charge the active takes take back, at most the whole;
 * of the disputes only, with `kind` */
export const taken_of = (takes: ITake[], kind?: ITake["kind"]) =>
  Math.min(
    takes
      .filter((t) => active(t) && (!kind || t.kind === kind))
      .reduce((sum, t) => sum + t.share, 0),
    1
  );

const party_key = (p: OwedParty) => JSON.stringify(p);

/**
 * what each party owes for the active takes. an npo whose grant has gone out
 * owes the share they all take, less the refunds a pooled rebook cut off it,
 * of what it received and of its card fee; one
 * whose grant hasn't owes the disputes' share only, a refund there being ops'
 * to settle by hand. a routed dist owes no share: a dispute holds its
 * transfer or, lost, reverses its cut, as a refund does. each active
 * dispute's fee is owed in full, split over the dists by settled amount,
 * routed ones included, and each referrer owes the whole share of its
 * commission paid or claimed for a transfer
 */
export function owed_targets(
  ds: LockedDist[],
  takes: ITake[]
): Map<string, OwedShare> {
  const all = taken_of(takes);
  const disputes = taken_of(takes, "dispute");
  const weights = ds.map(dist_settled_usd);
  const fees = ds.map(() => 0);
  for (const t of takes.filter((t) => active(t) && t.fee_usd > 0)) {
    for (const [i, c] of split_cents(t.fee_usd, weights).entries()) {
      fees[i]! += c;
    }
  }
  return new Map(
    owed_shares(ds, {
      f: all,
      // a rebook's cut took refunds only, so a dispute owes its share whole
      f_of: (d) =>
        d.routed
          ? 0
          : grant_went_out(d)
            ? past_cut(d.refunds_cut_share, all)
            : disputes,
      fee_usd: fees,
      owes: () => true,
    }).map((s) => [party_key(s.party), s])
  );
}

/**
 * each npo's part of the gift's active dispute fees, split over its dists by
 * settled amount, recorded on its row once the gift is reversed: the
 * reversal records what the dists received and their card fees only, and a
 * dispute whose open never ran recorded no fee. a fee its open recorded
 * already changes nothing
 */
export async function record_dispute_fees(
  tx: DbOrTx,
  r: { donation_id: string; src: OwedSource; now: string }
) {
  const takes = (await takes_of(tx, r.donation_id)).filter(
    (t) => active(t) && t.fee_usd > 0
  );
  if (takes.length === 0) return;
  const ds = await gift_dists_locked(tx, r.donation_id);
  const weights = ds.map(dist_settled_usd);
  const fees = new Map<number, number>();
  for (const t of takes) {
    for (const [i, c] of split_cents(t.fee_usd, weights).entries()) {
      const npo_id = ds[i]!.to_id;
      fees.set(npo_id, (fees.get(npo_id) ?? 0) + c);
    }
  }
  for (const [npo_id, fee] of fees) {
    if (fee <= 0) continue;
    // every figure only grows, so the zeros leave what the reversal recorded
    await record_owed(tx, {
      party: { npo_id },
      donation_id: r.donation_id,
      received_usd: 0,
      fee_processing_usd: 0,
      fee_dispute_usd: Math.round(fee * 100) / 100,
      ...r.src,
      now: r.now,
    });
  }
}

/**
 * the npo's row raised to what the gift's takes owe it plus `usd`, every cent
 * of its routed dist's transfer stripe refused to reverse for the gift's
 * refunds and lost disputes so far; its figures only grow, so a rerun
 * records nothing more
 */
export async function owe_unreversed(u: {
  donation_id: string;
  npo_id: number;
  usd: number;
  /** the refund or lost dispute whose cut was refused */
  source_ref: string;
  source: OwedSource["source"];
}) {
  await db.transaction(async (tx) => {
    const ds = await gift_dists_locked(tx, u.donation_id);
    const takes = await takes_of(tx, u.donation_id);
    const owes = [...owed_targets(ds, takes).values()].find(
      (s) => "npo_id" in s.party && s.party.npo_id === u.npo_id
    );
    await record_owed(tx, {
      donation_id: u.donation_id,
      party: { npo_id: u.npo_id },
      received_usd: (owes?.received_usd ?? 0) + u.usd,
      // the zeros leave what is recorded
      fee_processing_usd: 0,
      fee_dispute_usd: 0,
      source: u.source,
      source_ref: u.source_ref,
      now: new Date().toISOString(),
    });
  });
}

/**
 * the npo's row credited back the cut of its routed dist's transfer stripe
 * refused to reverse for a refund that then failed: the donor got nothing
 * back, so nothing is owed for it. keyed on the refund, so a rerun credits
 * nothing more, and counted as a failed refund, so a later record of the row
 * adds it back on rather than owing it again
 */
export async function credit_unreversed(u: {
  donation_id: string;
  npo_id: number;
  usd: number;
  refund_id: string;
}) {
  await db.transaction(async (tx) => {
    const party = { npo_id: u.npo_id };
    const row = await owed_for_party(u.donation_id, party, tx);
    if (!row) return;
    await credit_parts(
      tx,
      row,
      { donation_id: u.donation_id, party, now: new Date().toISOString() },
      [["refund_failed", u.usd, refund_failed_ref(u.refund_id)]]
    );
  });
}

export interface OwedMove {
  party: OwedParty;
  /** the row before anything was credited back; none when the party owed
   * nothing */
  was: IOwed | undefined;
  /** the row as it stands after; none when the party owes nothing */
  row: IOwed | undefined;
  /** what the take that gave its part back took off the row, and what it
   * would have but for what the row could still be credited */
  credited: number;
  wanted: number;
}

/**
 * each party's row brought up to what the gift's active takes owe now. a
 * take owes a party only once it is liable (its dist settled, its grant
 * gone out, its commission claimed or paid), and `move_owed` runs on the
 * gift's own events, so a dist's settlement and the commission run call
 * this. a grant going out is left to the gift's next event: what it makes
 * owed is a refund's share, which the refund told ops to settle by hand
 */
export async function owe_takes(
  tx: DbOrTx,
  donation_id: string,
  now: string
): Promise<void> {
  if (!(await takes_of(tx, donation_id)).some(active)) return;
  const ds = await settled_dists_locked(tx, donation_id);
  // read again under the lock: a take an event undid meanwhile is seen undone
  const takes = await takes_of(tx, donation_id);
  const first = takes.find(active);
  // all of it taken back: the gift is reversed, or its reversal is retried
  if (!first || taken_of(takes) >= 1) return;
  const src = {
    source: first.kind === "dispute" ? "dispute" : "refund",
    source_ref: first.ref,
  } as const;
  for (const s of owed_targets(ds, takes).values()) {
    if (s.received_usd + s.fee_processing_usd <= 0) continue;
    // a dispute fee splits over the dists settled so far, which a later dist
    // of the gift changes, and a row's figure never comes down: the fee waits
    // for the dispute's own next event, by when the gift is distributed
    await record_owed(tx, {
      ...s,
      fee_dispute_usd: 0,
      donation_id,
      ...src,
      now,
    });
  }
}

/** `owe_takes` for the gifts of `dist_ids`, each in a transaction of its
 * own. a failure is reported, not thrown: the money already moved, and the
 * gift's next event records what is owed anyway */
export async function owe_takes_of_dists(dist_ids: string[]): Promise<void> {
  if (dist_ids.length === 0) return;
  const gifts = await db
    .selectDistinct({ id: dists.donation_id })
    .from(dists)
    .where(inArray(dists.id, dist_ids));
  const now = new Date().toISOString();
  for (const { id } of gifts) {
    await db
      .transaction((tx) => owe_takes(tx, id, now))
      .catch((err) => report_error(err, { donation_id: id }));
  }
}

/** the take that gave back part of what it took between `before` and
 * `after`: undone, or shrunk by its chargeback */
const given_back = (before: ITake[], after: ITake[]) =>
  after.find((t) => {
    const b = before.find((x) => x.id === t.id);
    return b && active(b) && (!active(t) || t.share < b.share);
  });

/**
 * moves each party's row from what the takes `before` owe to what the takes
 * `after` owe: the row is brought up to what they owe now, which also catches
 * a party made liable since the last event (see `owe_takes`); a figure that
 * falls is credited back under the take that gave its part back, by the
 * difference of the two floors, so no cent of another take moves
 */
export async function move_owed(
  tx: DbOrTx,
  m: {
    donation_id: string;
    ds: LockedDist[];
    before: ITake[];
    after: ITake[];
    src: OwedSource;
    now: string;
  }
): Promise<OwedMove[]> {
  const was = owed_targets(m.ds, m.before);
  const now = owed_targets(m.ds, m.after);
  const fallen = given_back(m.before, m.after);
  const moves: OwedMove[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = now.get(key);
    const b = was.get(key);
    const party = (a ?? b)!.party;
    const fig = (s: OwedShare | undefined) => ({
      r: s?.received_usd ?? 0,
      p: s?.fee_processing_usd ?? 0,
      f: s?.fee_dispute_usd ?? 0,
    });
    const [x, y] = [fig(b), fig(a)];
    let row = await owed_for_party(m.donation_id, party, tx);
    // each figure only grows, so one already recorded stays as it is
    if (y.r > 0 || y.p > 0 || y.f > 0) {
      row = await record_owed(tx, {
        party,
        donation_id: m.donation_id,
        received_usd: y.r,
        fee_processing_usd: y.p,
        fee_dispute_usd: y.f,
        ...m.src,
        now: m.now,
      });
    }
    const before_credit = row;
    let credited = 0;
    let wanted = 0;
    if (fallen && row && (y.r < x.r || y.p < x.p || y.f < x.f)) {
      const parts = undo_parts(fallen, {
        r: x.r - y.r,
        p: x.p - y.p,
        f: x.f - y.f,
      });
      wanted = parts.reduce((sum, [, usd]) => sum + Math.max(usd, 0), 0);
      const after = await credit_parts(
        tx,
        row,
        { donation_id: m.donation_id, party, now: m.now },
        parts
      );
      credited = after.credited_back_usd - row.credited_back_usd;
      row = after;
    }
    moves.push({ party, was: before_credit, row, credited, wanted });
  }
  return moves;
}

/** the credits a take's fall is booked under, one per figure, each keyed on
 * the take so a redelivery adds nothing: a dispute shrunk by its chargeback
 * on that chargeback, so its later win books apart */
function undo_parts(
  t: ITake,
  fall: { r: number; p: number; f: number }
): CreditPart[] {
  if (t.kind === "refund") {
    return [
      ["refund_failed", fall.r, refund_failed_ref(t.ref)],
      ["refund_failed_fee", fall.p, `refund_failed_fee:${t.ref}`],
    ];
  }
  const id = active(t)
    ? `${t.id}:${t.chargeback_ref}`
    : (t.dispute_id ?? t.ref);
  return [
    ["dispute_won", fall.r, id],
    ["dispute_won_fee", fall.p, `${id}:fee`],
    ["dispute_won_fee_dispute", fall.f, `${id}:fee_dispute`],
  ];
}

/** the open claim a refund of `share` pays: an active dispute of the same
 * part with no chargeback, which the refund's own take then counts instead */
export const claim_paid = (takes: ITake[], share: number) =>
  takes.find(
    (t) =>
      active(t) &&
      t.kind === "dispute" &&
      t.chargeback_ref === null &&
      same_share(t.share, share)
  );

/** a refund: its id, its own part of the charge, and its time at the
 * provider when the event states it */
export interface RefundTake {
  ref: string;
  share: number;
  refunded_at?: string;
}

/** a refund's take, its own part of the charge, undoing the open claim it
 * pays; a redelivery's is on record */
export async function take_refund(
  tx: DbOrTx,
  donation_id: string,
  r: RefundTake
) {
  if (r.share <= 0) return;
  const takes = await takes_of(tx, donation_id);
  if (takes.some((t) => t.ref === r.ref)) return;
  const claim = claim_paid(takes, r.share);
  if (claim) await take_undo(tx, donation_id, claim.ref);
  await take_add(tx, {
    donation_id,
    ref: r.ref,
    kind: "refund",
    share: Math.min(r.share, 1),
    refunded_at: r.refunded_at ?? null,
  });
}

/**
 * a chargeback onto its dispute's take: a redelivery finds its take by its
 * own ref; else the dispute it names, else the dispute filed on the gift
 * whose own part it matches, won or not (its chargeback delivered late),
 * else the latest open one. with none, a take of its own, which a later
 * filing claims as `orphan_of` says
 */
export async function take_chargeback(
  tx: DbOrTx,
  c: {
    donation_id: string;
    ref: string;
    share: number;
    fee_usd: number;
    dispute_id?: string;
  }
) {
  const takes = await takes_of(tx, c.donation_id);
  if (takes.some((t) => t.chargeback_ref === c.ref)) return;
  const filed = takes.filter(
    (t) =>
      t.kind === "dispute" && t.dispute_id !== null && t.chargeback_ref === null
  );
  const own = c.dispute_id
    ? takes.find((t) => t.ref === c.dispute_id)
    : (filed.find((t) => same_share(t.share, c.share)) ??
      filed.filter(active).at(-1));
  if (own) {
    await take_update(tx, own.id, {
      chargeback_ref: c.ref,
      share: Math.min(c.share, 1),
      fee_usd: Math.max(own.fee_usd, c.fee_usd),
      ...(!active(own) &&
        !(await closed_for_gift(tx, own.dispute_id)) && {
          status: "active" as const,
        }),
    });
    return;
  }
  await take_add(tx, {
    donation_id: c.donation_id,
    ref: c.dispute_id ?? c.ref,
    kind: "dispute",
    share: Math.min(c.share, 1),
    fee_usd: c.fee_usd,
    dispute_id: c.dispute_id ?? null,
    chargeback_ref: c.ref,
  });
}

/** whether the dispute closed without the buyer keeping the money: a
 * chargeback of one undone by its win is its late delivery, which owes
 * nothing; one undone while still open was paired with a refund it turns
 * out not to be, and counts again */
async function closed_for_gift(tx: DbOrTx, dispute_id: string | null) {
  const d = dispute_id ? await dispute_get(dispute_id, tx) : undefined;
  return (
    d?.status === "won" ||
    d?.status === "accepted" ||
    d?.status === "inquiry_closed"
  );
}

/** the chargeback recorded before its dispute was filed that a dispute of
 * `share` is: the one of the same part; else the oldest recorded while the
 * gift had no dispute filed, as `take_chargeback` would have landed it on
 * this one had the filing come first; unsized, the oldest of any. `takes` in
 * the order they were recorded */
const orphan_of = (takes: ITake[], share: number | null) => {
  const orphans = takes.filter(
    (t) => active(t) && t.kind === "dispute" && t.dispute_id === null
  );
  if (share === null) return orphans[0];
  const unfiled = (o: ITake) =>
    !takes
      .slice(0, takes.indexOf(o))
      .some((t) => t.kind === "dispute" && t.dispute_id !== null);
  return (
    orphans.find((t) => same_share(t.share, share)) ?? orphans.find(unfiled)
  );
};

/** a dispute's take on record, claiming its chargeback recorded before it
 * unless `claims` is false */
export async function dispute_take(
  tx: DbOrTx,
  d: {
    donation_id: string;
    dispute_id: string;
    share: number | null;
    claims?: boolean;
  }
): Promise<ITake | undefined> {
  const takes = await takes_of(tx, d.donation_id);
  const own = takes.find((t) => t.ref === d.dispute_id);
  if (own || d.claims === false) return own;
  const orphan = orphan_of(takes, d.share);
  if (!orphan) return undefined;
  await take_update(tx, orphan.id, {
    ref: d.dispute_id,
    dispute_id: d.dispute_id,
  });
  return { ...orphan, ref: d.dispute_id, dispute_id: d.dispute_id };
}

/**
 * a dispute filed: its take, or the chargeback of it recorded before it,
 * which it claims as `orphan_of` says, the chargeback's part standing. `share`
 * null is a filing that can't be sized: with no chargeback to claim it takes
 * the rest of the charge. its own part stands once on record; a later filing
 * of it only raises the fee
 */
export async function take_dispute(
  tx: DbOrTx,
  d: {
    donation_id: string;
    dispute_id: string;
    share: number | null;
    fee_usd: number;
    /** when the provider opened it */
    opened_at: string;
  }
) {
  const own = await dispute_take(tx, d);
  if (own) {
    if (d.fee_usd > own.fee_usd) {
      await take_update(tx, own.id, { fee_usd: d.fee_usd });
    }
    return;
  }
  const takes = await takes_of(tx, d.donation_id);
  const share = d.share ?? Math.max(1 - taken_of(takes), 0);
  if (share <= 0) return;
  await take_add(tx, {
    donation_id: d.donation_id,
    ref: d.dispute_id,
    kind: "dispute",
    share: Math.min(share, 1),
    fee_usd: d.fee_usd,
    dispute_id: d.dispute_id,
    // the claim its refund already paid, as `take_refund` undoes it filed first
    ...(d.share !== null &&
      refund_paying(takes, d.share, d.opened_at) && {
        status: "undone" as const,
      }),
  });
}

/** whether a refund on record pays a claim of `share` opened at `opened_at`:
 * one of the same part, made at the provider after the claim was opened,
 * that no dispute of that part has been paired with. a refund made before
 * the claim opened is the donor's own, and the claim a dispute of what was
 * left; one of no known time pairs with nothing */
const refund_paying = (takes: ITake[], share: number, opened_at: string) =>
  !takes.some((t) => t.kind === "dispute" && same_share(t.share, share)) &&
  takes.some(
    (t) =>
      active(t) &&
      t.kind === "refund" &&
      same_share(t.share, share) &&
      t.refunded_at !== null &&
      Date.parse(t.refunded_at) > Date.parse(opened_at)
  );
