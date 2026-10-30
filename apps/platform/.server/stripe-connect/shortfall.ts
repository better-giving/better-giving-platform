import { and, eq, isNotNull } from "drizzle-orm";
import { stripe } from "../kit/stripe";
import type { DbOrTx } from "../pg/queries/helpers";
import { dists } from "../pg/schema/dist";

/** the transfer's metadata key that records a cut stripe refused to
 * reverse, by refund or dispute id; keys are capped at 40 characters */
export const SHORT = "short:";

/** cents of the transfer stripe refused to reverse, by refund or dispute */
export const shortfalls = (metadata: Record<string, string> | null) =>
  new Map(
    Object.entries(metadata ?? {})
      .filter(([k]) => k.startsWith(SHORT))
      .map(([k, v]) => [k.slice(SHORT.length), Number(v)])
  );

/** every cut of the npo's transfers for the gift stripe refused to reverse,
 * as marked on them: what `owe_unreversed` records as owed past the takes */
export async function refused_usd(
  tx: DbOrTx,
  donation_id: string,
  npo_id: number
): Promise<number> {
  const rows = await tx
    .select({ id: dists.stripe_transfer_id })
    .from(dists)
    .where(
      and(
        eq(dists.donation_id, donation_id),
        eq(dists.to_id, npo_id),
        isNotNull(dists.stripe_transfer_id)
      )
    );
  let cents = 0;
  for (const { id } of rows) {
    const tr = await stripe.transfers.retrieve(id!);
    for (const c of shortfalls(tr.metadata).values()) cents += c;
  }
  return cents / 100;
}
