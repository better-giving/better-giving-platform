import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { IRefundedStatus } from "@/payouts";
import { bal_tx_put } from "../pg/queries/bal-tx";
import { donation_message_del } from "../pg/queries/donation-message";
import { form_ltd_inc } from "../pg/queries/form";
import type { DbOrTx } from "../pg/queries/helpers";
import { nav_log_append } from "../pg/queries/nav";
import { npo_balance_update } from "../pg/queries/npo";
import { type IOwed, type IOwedRecord, record_owed } from "../pg/queries/owed";
import {
  payout_mark_refunded_loss,
  payout_move_from_unsent,
} from "../pg/queries/payout";
import { npo_prog_contrib } from "../pg/queries/program";
import { commission_refund } from "../pg/queries/referrer";
import { rev_log_update_status } from "../pg/queries/revenue";
import { dists } from "../pg/schema/dist";
import { referrer_commissions } from "../pg/schema/referrer";
import { loss_logs } from "../pg/schema/revenue";
import type { OwedFigure, ReferrerParty, RefundPlan } from "./plan";

/** another writer moved the plan's payout since: out of `pending`/`returned`
 * for a cancel, or back into the npo's cash (or void) for a loss */
export class StalePayoutError extends Error {
  constructor(payout_id: string, planned: "unsent" | "sent") {
    super(
      planned === "unsent"
        ? `payout:${payout_id} is no longer pending or returned`
        : `payout:${payout_id} is no longer a grant that went out`
    );
    this.name = "StalePayoutError";
  }
}

/** the refund or dispute an owed figure is recorded against */
export type OwedSource = Pick<IOwedRecord, "source" | "source_ref">;

export interface IAppliedRefund {
  /** each party's row as it stands, one per party */
  owed: IOwed[];
  /** the commission was claimed by a Wise transfer: its referrer owes it if
   * that transfer pays */
  commission_in_flight?: { donation_id: string; amount: number; ref?: string };
}

export async function apply_refund_plan(
  tx: DbOrTx,
  plan: RefundPlan,
  src: OwedSource
): Promise<IAppliedRefund> {
  const res: IAppliedRefund = { owed: [] };

  for (const e of plan.effects) {
    switch (e.kind) {
      case "balance_update":
        await npo_balance_update(tx, e.npo_id, e.deltas, "dec");
        break;
      case "bal_tx_put":
        await bal_tx_put(tx, e.tx);
        break;
      case "nav_log":
        await nav_log_append(tx, e.entry);
        break;
      case "payout_status": {
        if (e.status === "refunded_loss") {
          const marked = await payout_mark_refunded_loss(tx, e.payout_id);
          if (!marked) throw new StalePayoutError(e.payout_id, "sent");
          break;
        }
        const changed = await payout_move_from_unsent(tx, e.payout_id, {
          type: "refunded",
        } as IRefundedStatus);
        if (!changed) throw new StalePayoutError(e.payout_id, "unsent");
        break;
      }
      case "rev_log_status":
        await rev_log_update_status(tx, e.rev_log_id, e.status);
        break;
      case "commission_status": {
        const was = await commission_refund(tx, e.donation_id, e.status);
        if (was?.status === "processing") {
          const { donation_id, amount, ref } = was;
          res.commission_in_flight = { donation_id, amount, ref };
        }
        if (was?.status === "processing" || was?.status === "paid") {
          const others = await referrer_owed_on_other_dists(
            tx,
            e.owed,
            was.donation_id
          );
          res.owed.push(
            await record_owed(tx, {
              ...e.owed,
              received_usd: e.owed.received_usd + others,
              ...src,
            })
          );
        }
        break;
      }
      case "form_decrement":
        await form_ltd_inc(tx, e.form_id, -e.net, -1);
        break;
      case "program_decrement":
        await npo_prog_contrib(tx, e.program_id, -e.net);
        break;
      case "donation_message_del":
        await donation_message_del(tx, e.donation_id);
        break;
      case "owed":
        res.owed.push(await record_owed(tx, { ...e.owed, ...src }));
        break;
      case "loss_log":
        await tx
          .insert(loss_logs)
          .values(e.loss)
          .onConflictDoNothing({ target: loss_logs.id });
        break;
    }
  }

  return res;
}

/** what the gift's other dists, already reversed, left owed to the same
 * referrer: their commissions paid, or claimed by a transfer when refunded.
 * the row is one per gift per party, so it carries their sum */
async function referrer_owed_on_other_dists(
  tx: DbOrTx,
  owed: OwedFigure & { party: ReferrerParty },
  dist_id: string
): Promise<number> {
  const { party } = owed;
  const key = `${owed.donation_id}:${"referrer_user" in party ? `u:${party.referrer_user}` : `n:${party.referrer_npo}`}`;
  // held to commit: a run applying a sibling dist for this referrer waits
  // here, and its read below then sees this one's commit
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  );
  const [row] = await tx
    .select({
      usd: sql<number>`coalesce(sum(${referrer_commissions.amount}), 0)`.mapWith(
        Number
      ),
    })
    .from(referrer_commissions)
    .innerJoin(dists, eq(dists.id, referrer_commissions.donation_id))
    .where(
      and(
        eq(dists.donation_id, owed.donation_id),
        ne(dists.id, dist_id),
        inArray(dists.refund_status, ["completed", "loss"]),
        "referrer_user" in party
          ? eq(referrer_commissions.referrer_user, party.referrer_user)
          : eq(referrer_commissions.referrer_npo, party.referrer_npo),
        or(
          eq(referrer_commissions.status, "paid"),
          and(
            eq(referrer_commissions.status, "refunded_loss"),
            isNotNull(referrer_commissions.ref)
          )
        )
      )
    );
  return row?.usd ?? 0;
}
