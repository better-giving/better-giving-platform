import { and, eq, isNotNull } from "drizzle-orm";
import { is_reversed } from "@/donations/settle";
import { msg } from "@/queue";
import { enqueue } from "../kit/queue";
import { db } from "../pg/db";
import { disputes_of_donation } from "../pg/queries/dispute";
import {
  dists_routed_untransferred,
  type IDistAwaitingTransfer,
} from "../pg/queries/dist";
import { donation_status_shared } from "../pg/queries/donation";
import { dists } from "../pg/schema/dist";

/**
 * sends the transfers a dispute held (`transfer_routed_dist`) once it closed:
 * one `connect-transfer` per routed dist of the gift no transfer has paid,
 * returning the dists it released. none while a dispute on the gift is still
 * open, nor once the gift is reversed. the job's stored check, its lookup of a
 * transfer made and its idempotency key keep a release and the held
 * delivery's retry to one transfer
 */
export async function release_held_transfers(
  donation_id: string,
  intent_id: string,
  dispute_id: string
): Promise<IDistAwaitingTransfer[]> {
  const disputes = await disputes_of_donation(donation_id);
  if (disputes.some((d) => d.status === "open")) return [];
  const status = await donation_status_shared(db, donation_id);
  if (!status || is_reversed(status)) return [];
  const held = await dists_routed_untransferred(donation_id);
  if (held.length === 0) return [];
  await enqueue(
    ...held.map((d) =>
      msg("connect-transfer", {
        dist_id: d.id,
        donation_id,
        intent_id,
        release: dispute_id,
      })
    )
  );
  return held;
}

/** for a dispute's open notice, one line per routed dist of the gift: its
 * transfer held, or already sent and left alone */
export async function routed_open_lines(donation_id: string) {
  const routed = await db
    .select({
      id: dists.id,
      npo_id: dists.to_id,
      transfer_id: dists.stripe_transfer_id,
    })
    .from(dists)
    .where(
      and(eq(dists.donation_id, donation_id), isNotNull(dists.stripe_routed_to))
    );
  return routed.map((d) =>
    d.transfer_id
      ? `dist ${d.id}: transfer ${d.transfer_id} to npo ${d.npo_id} already sent, left alone until the dispute closes; a loss reverses its share`
      : `dist ${d.id}: transfer to npo ${d.npo_id} held until the dispute closes`
  );
}

/** for a dispute's close notice, one line per transfer it released */
export const released_lines = (released: IDistAwaitingTransfer[]) =>
  released.map(
    (d) =>
      `dist ${d.id}: transfer to npo ${d.to_id} released, held while the dispute was open`
  );
