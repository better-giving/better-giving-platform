import { humanize } from "@/helpers/decimal";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { owed_total } from "../pg/queries/owed";
import { type ITake, takes_of } from "../pg/queries/take";
import type { OwedSource } from "./apply";
import { grant_went_out, settled_dists_locked } from "./share";
import { move_owed, taken_of } from "./takes";

export interface TakesPut {
  donation_id: string;
  /** what a party's row records it against, when this event writes it first */
  src: OwedSource;
  /** puts this event's takes on record, under the gift's lock */
  put: (tx: DbOrTx, before: ITake[]) => Promise<void>;
  /** the event is a refund, which owes nothing on a grant not yet out */
  refund: boolean;
}

export type TakesRecorded =
  /** no dist left to take a share of: none distributed yet, or every one
   * reversed since the gift was read. nothing written */
  | { status: "undistributed" }
  /** the takes on record now take the whole charge: the caller reverses the
   * gift, nothing owed written here */
  | { status: "whole" }
  | {
      status: "share";
      /** the share all the gift's takes take back now */
      taken: number;
      /** what each party now owes back, one line per row */
      owed_msgs: string[];
      /** one line per dist whose grant hasn't gone out, so nothing of this
       * refund is owed for it */
      pending: string[];
    };

/**
 * puts an event's takes on the gift's ledger under its lock and, while they
 * take less than the whole charge, moves each party's row by what that
 * changes. a redelivery finds its takes on record and changes nothing.
 * reverses nothing
 */
export async function record_takes(s: TakesPut): Promise<TakesRecorded> {
  const now = new Date().toISOString();
  return db.transaction(async (tx): Promise<TakesRecorded> => {
    const ds = await settled_dists_locked(tx, s.donation_id);
    if (ds.length === 0) return { status: "undistributed" };
    const before = await takes_of(tx, s.donation_id);
    await s.put(tx, before);
    const after = await takes_of(tx, s.donation_id);
    const taken = taken_of(after);
    if (taken >= 1) return { status: "whole" };

    const moves = await move_owed(tx, {
      donation_id: s.donation_id,
      ds,
      before,
      after,
      src: s.src,
      now,
    });
    const names = new Map(ds.map((d) => [d.to_id, d.to_name]));
    const owed_msgs = moves.flatMap(({ party, row }) => {
      if (!row) return [];
      const usd = humanize(owed_total(row));
      return [
        "npo_id" in party
          ? `$${usd} recorded as owed by ${names.get(party.npo_id) || "its npo"} (npo ${party.npo_id}), to recover from its future grants`
          : `$${usd} of its commission recorded as owed by referrer ${"referrer_user" in party ? party.referrer_user : party.referrer_npo}, to recover from its next commission`,
      ];
    });
    const pending = s.refund
      ? ds
          .filter((d) => !d.routed && !grant_went_out(d))
          .map(
            (d) =>
              `dist ${d.id} to ${d.to_name || "its npo"} (npo ${d.to_id}): ${not_out_why(d.payout_type)}, so nothing of it is recorded as owed`
          )
      : [];
    return { status: "share", taken, owed_msgs, pending };
  });
}

const not_out_why = (payout_type: string | null) => {
  if (payout_type === "pending") return "its grant payout is still pending";
  if (payout_type === "returned") {
    return "its grant payout came back and is not yet re-sent";
  }
  if (payout_type === "void") return "its grant payout is void";
  return "its share is still in the npo's balances";
};
