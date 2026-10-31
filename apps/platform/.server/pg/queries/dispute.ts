import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { donation_disputes } from "../schema/dispute";
import type { DbOrTx } from "./helpers";

export type IDispute = typeof donation_disputes.$inferSelect;

export interface IDisputeOpen {
  /** the provider's dispute id */
  id: string;
  donation_id: string;
  /** when the provider opened it, not when we heard */
  opened_at: string;
}

export interface IDisputeOpened {
  /** as it stands: a close recorded first stands */
  status: IDispute["status"];
  /** this call put the dispute on record; every other call for it, however
   * concurrent, finds it */
  inserted: boolean;
}

/** the row is held locked until `tx` ends, so a close of it waits */
export async function dispute_open(
  tx: DbOrTx,
  d: IDisputeOpen
): Promise<IDisputeOpened> {
  const [added] = await tx
    .insert(donation_disputes)
    .values({ ...d, status: "open" })
    .onConflictDoNothing({ target: donation_disputes.id })
    .returning({ status: donation_disputes.status });
  if (added) return { status: added.status, inserted: true };
  const [row] = await tx
    .select({ status: donation_disputes.status })
    .from(donation_disputes)
    .where(eq(donation_disputes.id, d.id))
    .for("update");
  return { status: row!.status, inserted: false };
}

export interface IDisputeClose extends IDisputeOpen {
  /** `inquiry_closed`: an inquiry that ended with no chargeback, so nothing
   * was taken or owed. `accepted`: the claim was accepted and the buyer paid
   * through a refund, which counts it, so it is not a loss */
  status: Exclude<IDispute["status"], "open">;
  closed_at: string;
}

/** recorded closed whether or not its open was; the first close stands.
 * the status that stands: this close's when it stood, its redelivery's
 * included; another when the dispute was closed otherwise first */
export async function dispute_close(
  tx: DbOrTx,
  d: IDisputeClose
): Promise<IDispute["status"]> {
  const [row] = await tx
    .insert(donation_disputes)
    .values(d)
    .onConflictDoUpdate({
      target: donation_disputes.id,
      set: { status: d.status, closed_at: d.closed_at },
      setWhere: eq(donation_disputes.status, "open"),
    })
    .returning({ status: donation_disputes.status });
  if (row) return row.status;
  const [kept] = await tx
    .select({ status: donation_disputes.status })
    .from(donation_disputes)
    .where(eq(donation_disputes.id, d.id));
  return kept!.status;
}

/** a mirror of the dispute's take as its open left it, for the notices that
 * read it off the record: its own share, what the gift's takes took then,
 * and its fee */
export async function dispute_record_share(
  tx: DbOrTx,
  id: string,
  s: { share: number; cumulative_share: number; fee_usd: number }
): Promise<void> {
  await tx.update(donation_disputes).set(s).where(eq(donation_disputes.id, id));
}

/** this dispute's loss reversed the gift. a redelivery leaves the first
 * stamp. the win reads it to tell that reversal from a loss that only
 * closed the row. a row already closed won is not stamped: a late loss
 * must not mark a win as the reversal */
export async function dispute_mark_loss_reversed(
  tx: DbOrTx,
  id: string,
  at: string
): Promise<void> {
  await tx
    .update(donation_disputes)
    .set({ loss_recorded_at: at })
    .where(
      and(
        eq(donation_disputes.id, id),
        eq(donation_disputes.status, "lost"),
        isNull(donation_disputes.loss_recorded_at)
      )
    );
}

/** the gift's disputes on record, open or closed */
export async function disputes_of_donation(
  donation_id: string,
  tx: DbOrTx = db
): Promise<Pick<IDispute, "id" | "status">[]> {
  return tx
    .select({ id: donation_disputes.id, status: donation_disputes.status })
    .from(donation_disputes)
    .where(eq(donation_disputes.donation_id, donation_id));
}

export async function dispute_get(
  id: string,
  tx: DbOrTx = db
): Promise<IDispute | undefined> {
  const [row] = await tx
    .select()
    .from(donation_disputes)
    .where(eq(donation_disputes.id, id));
  return row;
}
