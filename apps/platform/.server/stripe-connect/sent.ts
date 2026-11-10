import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import Stripe from "stripe";
import { report_degraded } from "#/errors/report";
import { is_reversed } from "@/donations/settle";
import { is_routable, routing_npo } from "@/stripe-connect/eligibility";
import {
  type INpoSent,
  type ISentTransfer,
  type IUnsentTransfer,
  routed_kind,
  type TSentStanding,
  transfer_standing,
} from "@/stripe-connect/sent";
import { stripe as stripe_env } from "../env";
import { stripe } from "../kit/stripe";
import { payout_total } from "../payouts/amount";
import { db } from "../pg/db";
import { npo_get } from "../pg/queries/npo";
import { dists } from "../pg/schema/dist";

/** one retrieve per transfer; past this the page names that it stopped */
const SENT_LIMIT = 100;

/** stripe transfer reads in flight for one page. the rest wait */
export const RETRIEVE_BATCH = 10;

interface ITransferRow {
  id: string;
  net: number | null;
  /** the dist was refunded */
  reversed: boolean;
  date: string;
}

/** a transfer as stripe returns it, the fields this page reads */
interface ITransferRecord {
  id: string;
  amount: number;
  amount_reversed: number;
  created: number;
  reversals?: {
    data: { amount: number }[];
    has_more: boolean;
  };
}

/**
 * routed transfers paid to `npo_id`, newest transfer first, each with what
 * its reversal records took back. null when card gifts to the nonprofit do
 * not route, no account is linked (or routing is switched off) and it has
 * none: the payouts page stays as it is. an empty list is a nonprofit on
 * stripe, or linked to an account card gifts don't route to, that nothing has
 * been sent to
 */
export async function npo_sent_transfers(
  npo_id: number
): Promise<INpoSent | null> {
  const [npo, rows, unsent_rows] = await Promise.all([
    npo_get(npo_id),
    db
      .select({
        id: dists.stripe_transfer_id,
        net: dists.net,
        status: dists.status,
        transferred_at: dists.stripe_transfer_created_at,
        donated_at: dists.date_created,
      })
      .from(dists)
      .where(and(eq(dists.to_id, npo_id), isNotNull(dists.stripe_transfer_id)))
      // the transfer is created later than the donation, and a retry later
      // still. a row with no stored transfer time keeps the donation's date
      .orderBy(
        desc(
          sql`coalesce(${dists.stripe_transfer_created_at}, ${dists.date_created})`
        ),
        desc(dists.id)
      )
      .limit(SENT_LIMIT + 1),
    db
      .select({
        id: dists.id,
        net: dists.net,
        status: dists.status,
        routed_at: dists.date_created,
      })
      .from(dists)
      .where(
        and(
          eq(dists.to_id, npo_id),
          isNotNull(dists.stripe_routed_to),
          isNull(dists.stripe_transfer_id)
        )
      )
      .orderBy(desc(dists.date_created), desc(dists.id))
      .limit(SENT_LIMIT),
  ]);
  const unsent: IUnsentTransfer[] = unsent_rows.map((r) => ({
    id: r.id,
    // usd the transfer will send, so it sits to the cent beside the sent rows
    amount: payout_total([r.net ?? 0]),
    date: r.routed_at,
    kind: routed_kind({
      transfer_id: null,
      reversed: is_reversed(r.status),
      routed_at: r.routed_at,
    }) as IUnsentTransfer["kind"],
  }));

  const on_stripe =
    !!npo && is_routable(routing_npo(npo), stripe_env.connect_routing);
  const connected =
    !!npo?.stripe_account_id && npo.stripe_deauthorized_at === null;
  const linked = connected && stripe_env.connect_routing;
  if (!on_stripe && !linked && rows.length === 0 && unsent.length === 0) {
    return null;
  }

  const truncated = rows.length > SENT_LIMIT;
  const listed = rows.slice(0, SENT_LIMIT).flatMap((row) =>
    row.id === null
      ? []
      : [
          {
            id: row.id,
            net: row.net,
            reversed: is_reversed(row.status),
            date: row.transferred_at ?? row.donated_at,
          },
        ]
  );
  const items = await in_batches(listed, (row) => sent_of(npo_id, row));
  items.sort((a, b) => b.date.localeCompare(a.date));
  return { items, unsent, truncated, on_stripe, connected };
}

/** `run` over `items`, RETRIEVE_BATCH at a time, in that order. a rejection
 * rejects the page and drops the rows already read */
async function in_batches<T, R>(
  items: T[],
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += RETRIEVE_BATCH) {
    const part = await Promise.all(items.slice(i, i + RETRIEVE_BATCH).map(run));
    out.push(...part);
  }
  return out;
}

/** cents the transfer's reversal records add up to. an incomplete page of
 * them is not a total, so the transfer's own reversed amount — stripe's sum
 * of every reversal — stands in */
function reversal_cents(tr: ITransferRecord): number {
  const list = tr.reversals;
  if (!list || list.has_more) return tr.amount_reversed;
  return list.data.reduce((sum, r) => sum + r.amount, 0);
}

async function sent_of(
  npo_id: number,
  row: ITransferRow
): Promise<ISentTransfer> {
  try {
    const tr = (await stripe.transfers.retrieve(row.id, {
      expand: ["reversals"],
    })) as ITransferRecord;
    const read = transfer_standing(tr.amount, reversal_cents(tr));
    // refunded, yet stripe holds no reversal: it refused, and the money stayed
    const standing: TSentStanding =
      read.kind === "paid" && row.reversed ? { kind: "kept" } : read;
    return {
      id: tr.id,
      amount: tr.amount / 100,
      date: new Date(tr.created * 1000).toISOString(),
      standing,
    };
  } catch (err) {
    // a miss here is stripe, not this page: the amount we sent is on the
    // dist, and a standing we could not read is not "paid out"
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    report_degraded(err, { npo_id, transfer_id: row.id });
    return {
      id: row.id,
      // usd the transfer sent: the same cents a payout of this net would, as usd
      amount: payout_total([row.net ?? 0]),
      date: row.date,
      standing: { kind: "unknown" },
    };
  }
}
