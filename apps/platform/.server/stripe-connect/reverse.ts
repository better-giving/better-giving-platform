import { and, eq, isNotNull, sql } from "drizzle-orm";
import { report_error } from "#/errors/report";
import { humanize } from "@/helpers/decimal";
import { stripe } from "../kit/stripe";
import { db } from "../pg/db";
import { dists } from "../pg/schema/dist";
import type { IRoutedRefundFailed, RoutedRefunds } from "../refund/reverse";
import { credit_unreversed, owe_unreversed } from "../refund/takes";
import { is_refusal } from "./refusal";

interface IRoutedTransfer {
  donation_id: string;
  dist_id: string;
  npo_id: number;
  npo_name: string | null;
  transfer_id: string;
}

/** what took part of the charge back from us: a refund, or a dispute lost */
export interface ITakeBack {
  kind: "refund" | "dispute";
  id: string;
  /** in the charge's unit */
  amount: number;
  created_at?: string;
}

/** a take-back's own cut of a transfer, in its cents */
interface ICut {
  kind: ITakeBack["kind"];
  id: string;
  amount: number;
}

/**
 * each unanswered take-back's cut of the transfer, in proportion to its part
 * of the charge, to the nearest cent. `answered` holds what earlier runs cut
 * for the others (reversed, or refused and marked), which count first, so a
 * take-back answered out of time order shifts no cent; the rest are cut off
 * the running total, oldest first, so all the cuts sum to what the takes take
 * together and a charge taken back whole reverses the whole transfer. ties on
 * time break on the id, so every run cuts alike
 */
export function take_cuts(
  transferred: number,
  of: number,
  takes: ITakeBack[],
  answered: ReadonlyMap<string, number> = new Map()
) {
  const oldest_first = [...takes].sort(
    (a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id)
  );
  const done = oldest_first.filter((t) => answered.has(t.id));
  let taken = Math.min(
    done.reduce((sum, t) => sum + t.amount, 0),
    of
  );
  let cut_so_far = done.reduce((sum, t) => sum + answered.get(t.id)!, 0);
  const cuts: ICut[] = [];
  for (const t of oldest_first.filter((t) => !answered.has(t.id))) {
    taken = Math.min(taken + t.amount, of);
    const due = Math.round((transferred * taken) / of);
    const amount = Math.max(due - cut_so_far, 0);
    cuts.push({ kind: t.kind, id: t.id, amount });
    cut_so_far += amount;
  }
  return cuts;
}

/** the transfer's metadata key that records a cut stripe refused to
 * reverse, by refund or dispute id; keys are capped at 40 characters */
const SHORT = "short:";

/** cents of the transfer stripe refused to reverse, by refund or dispute */
const shortfalls = (metadata: Record<string, string> | null) =>
  new Map(
    Object.entries(metadata ?? {})
      .filter(([k]) => k.startsWith(SHORT))
      .map(([k, v]) => [k.slice(SHORT.length), Number(v)])
  );

/** a reversal's metadata key naming what it answers */
const ANSWERS = { refund: "refund_id", dispute: "dispute_id" } as const;

/** the charge's disputes stripe decided against us, each taking its amount */
export async function lost_disputes(charge: string): Promise<ITakeBack[]> {
  const { data } = await stripe.disputes.list({ charge, limit: 100 });
  return data
    .filter((d) => d.status === "lost")
    .map((d) => ({
      kind: "dispute",
      id: d.id,
      amount: d.amount,
      created_at: new Date(d.created * 1000).toISOString(),
    }));
}

/**
 * takes back from each connected account the gift's routed dists were paid
 * to the cut of its transfer the charge's refunds and lost disputes took. a
 * separate transfer is untouched by either (stripe's `reverse_transfer`
 * reverses a destination charge's own, and a dispute debits the platform),
 * so this is the only thing that takes the money back. the lost disputes are
 * read off the transfer's source charge, so every caller reverses both. one
 * ops line per cut this run reversed or found refused
 */
export async function reverse_routed_refunds(
  donation_id: string,
  c: RoutedRefunds
): Promise<string[]> {
  const lost = new Map<string, Promise<ITakeBack[]>>();
  const lost_of = (charge: string) => {
    if (!lost.has(charge)) lost.set(charge, lost_disputes(charge));
    return lost.get(charge)!;
  };
  const lines: string[] = [];
  for (const t of await transferred_of(donation_id)) {
    lines.push(...(await reverse_taken_share(t, c, lost_of)));
  }
  return lines;
}

/** the gift's dists a stripe transfer paid, whatever became of them since */
const transferred_of = async (donation_id: string) =>
  (
    await db
      .select({
        dist_id: dists.id,
        npo_id: sql<number>`${dists.to_id}`,
        npo_name: dists.to_name,
        transfer_id: sql<string>`${dists.stripe_transfer_id}`,
      })
      .from(dists)
      .where(
        and(
          eq(dists.donation_id, donation_id),
          isNotNull(dists.stripe_transfer_id)
        )
      )
  ).map((t) => ({ donation_id, ...t }));

const usd = (cents: number) => `$${humanize(cents / 100)}`;

/**
 * reverses each take-back's cut of `t` once: a cut stripe has reversed, or
 * refused and was marked on the transfer, is answered already. a cut stripe
 * refuses (the account's balance can't cover it, the account is gone) is
 * marked and reported, and every marked cut is then recorded as owed by the
 * npo; the donor's refund or the chargeback stands either way. anything else
 * throws, for the caller to retry
 */
async function reverse_taken_share(
  t: IRoutedTransfer,
  c: RoutedRefunds,
  lost_of: (charge: string) => Promise<ITakeBack[]>
): Promise<string[]> {
  const tr = await stripe.transfers.retrieve(t.transfer_id);
  const charge =
    typeof tr.source_transaction === "string"
      ? tr.source_transaction
      : tr.source_transaction?.id;
  // an unsent refund can still fail: its own event cuts it once sent
  const unsent = new Set(c.unsent);
  const takes: ITakeBack[] = [
    ...c.refunds
      .filter((r) => !unsent.has(r.id))
      .map((r) => ({ kind: "refund" as const, ...r })),
    ...(charge ? await lost_of(charge) : []),
  ];
  if (takes.length === 0) return [];
  const { data: reversals } = await stripe.transfers.listReversals(
    t.transfer_id,
    { limit: 100 }
  );
  const short = shortfalls(tr.metadata);
  // what earlier runs cut for each take-back: reversed, or refused and marked
  const answered = new Map(short);
  for (const r of reversals) {
    const id = r.metadata?.refund_id ?? r.metadata?.dispute_id;
    if (id) answered.set(id, (answered.get(id) ?? 0) + r.amount);
  }
  let left = tr.amount - tr.amount_reversed;
  const at = `dist ${t.dist_id} to ${t.npo_name || "its npo"} (npo ${t.npo_id})`;
  const lines: string[] = [];

  for (const cut of take_cuts(tr.amount, c.of, takes, answered)) {
    // a reversal made by hand already took part of it back
    const amount = Math.min(cut.amount, left);
    if (amount <= 0) continue;
    try {
      await stripe.transfers.createReversal(
        t.transfer_id,
        {
          amount,
          metadata: {
            [ANSWERS[cut.kind]]: cut.id,
            dist_id: t.dist_id,
            donation_id: t.donation_id,
          },
        },
        { idempotencyKey: `connect-reversal:${cut.id}:${t.dist_id}` }
      );
      left -= amount;
      lines.push(
        `${at}: ${usd(amount)} reversed from transfer ${t.transfer_id} for ${cut.kind} ${cut.id}`
      );
    } catch (e) {
      // as stripe threw it: the webhook route answers its transient errors
      // 503 for stripe's redelivery, unreported
      if (!is_refusal(e)) throw e;
      short.set(cut.id, amount);
      // no later run asks stripe again for a cut marked here
      await stripe.transfers.update(t.transfer_id, {
        metadata: { [`${SHORT}${cut.id}`]: String(amount) },
      });
      report_error(
        new Error(
          `${amount} cents of ${cut.kind} ${cut.id} not reversed from transfer ${t.transfer_id}: recorded as owed by npo ${t.npo_id}`,
          { cause: e }
        ),
        {
          donation_id: t.donation_id,
          dist_id: t.dist_id,
          transfer_id: t.transfer_id,
          [ANSWERS[cut.kind]]: cut.id,
          stripe_code: e.code,
        }
      );
      lines.push(
        `${at}: stripe refused to reverse ${usd(amount)} from transfer ${t.transfer_id} for ${cut.kind} ${cut.id}; recorded as owed by npo ${t.npo_id}`
      );
    }
  }
  // every cut marked refused, this run's and earlier ones', so a run that
  // died between a mark and this write has it recorded by the next. a
  // refund failed since is no longer among them: its credit stands
  const owed = [...short].filter(([id]) => takes.some((x) => x.id === id));
  if (owed.length > 0) {
    const first = owed[0]![0];
    await owe_unreversed({
      donation_id: t.donation_id,
      npo_id: t.npo_id,
      usd: owed.reduce((sum, [, cents]) => sum + cents, 0) / 100,
      source_ref: first,
      source: takes.find((x) => x.id === first)!.kind,
    });
  }
  return lines;
}

/**
 * what the gift's routed dists had taken back for a refund that failed after
 * it succeeded, for ops, one line per dist as `refund_failed` words them. a
 * cut stripe refused, recorded owed, is credited back here: `credited`. a
 * cut reversed from a transfer is ours again and the npo's to be paid back by
 * hand: `by_hand`
 */
export async function routed_refund_failed(
  donation_id: string,
  refund_id: string
): Promise<IRoutedRefundFailed> {
  const credited: string[] = [];
  const by_hand: string[] = [];
  for (const t of await transferred_of(donation_id)) {
    const tr = await stripe.transfers.retrieve(t.transfer_id);
    const { data: reversals } = await stripe.transfers.listReversals(
      t.transfer_id,
      { limit: 100 }
    );
    const at = `dist ${t.dist_id} to ${t.npo_name || "its npo"} (npo ${t.npo_id})`;
    const reversed = reversals.find((r) => r.metadata?.refund_id === refund_id);
    if (reversed) {
      by_hand.push(
        `${at}: $${humanize(reversed.amount / 100)} reversed from transfer ${t.transfer_id} for this refund; re-pay it to the nonprofit by hand. if a later refund of this charge comes in, reverse that re-payment by hand too: its transfer isn't on record, so the refund won't reverse it`
      );
    }
    const cents = shortfalls(tr.metadata).get(refund_id);
    if (cents) {
      await credit_unreversed({
        donation_id,
        npo_id: t.npo_id,
        usd: cents / 100,
        refund_id,
      });
      credited.push(
        `${at}: its $${humanize(cents / 100)} shortfall, which stripe refused to reverse from transfer ${t.transfer_id} and was recorded owed, is credited back`
      );
    }
  }
  return { credited, by_hand };
}

/**
 * what the gift's transfers had taken back for a lost dispute that was then
 * won, for ops, one line per transfer: a reversal stripe made for it, to
 * re-pay by hand, and a cut it refused, recorded owed, to credit by hand
 */
export async function routed_dispute_reversals(
  donation_id: string,
  dispute_id: string
): Promise<string[]> {
  const lines: string[] = [];
  for (const t of await transferred_of(donation_id)) {
    const tr = await stripe.transfers.retrieve(t.transfer_id);
    const { data: reversals } = await stripe.transfers.listReversals(
      t.transfer_id,
      { limit: 100 }
    );
    const at = `dist ${t.dist_id} to ${t.npo_name || "its npo"} (npo ${t.npo_id})`;
    const reversed = reversals.find(
      (r) => r.metadata?.dispute_id === dispute_id
    );
    if (reversed) {
      lines.push(
        `${at}: ${usd(reversed.amount)} reversed from transfer ${t.transfer_id} for this dispute; re-pay it to the nonprofit by hand`
      );
    }
    const cents = shortfalls(tr.metadata).get(dispute_id);
    if (cents) {
      lines.push(
        `${at}: its ${usd(cents)} shortfall, which stripe refused to reverse from transfer ${t.transfer_id} for this dispute, is recorded owed; credit it back by hand`
      );
    }
  }
  return lines;
}
