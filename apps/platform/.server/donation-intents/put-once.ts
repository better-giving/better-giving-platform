import type { IDonation } from "@/donations";
import type { Db } from "../pg/db";
import { is_unique_violation } from "../pg/errors";
import { donation_get, donation_put } from "../pg/queries/donation";

/** the row for an intent. a caller that minted the id itself (`minted`) may be
 * retrying a request that already wrote it: that unpaid row is reused, so the
 * retry's processor call carries the same key and finds the same object */
export async function put_or_reuse(
  db: Db,
  row: IDonation,
  minted: boolean
): Promise<IDonation> {
  try {
    return await donation_put(db, row);
  } catch (err) {
    if (!minted || !is_unique_violation(err, "donations_pkey")) throw err;
    const prior = await donation_get(row.id);
    // only a row still in the state this request writes: one paid or closed
    // meanwhile is not a retry's to reuse
    if (prior?.status !== row.status) throw err;
    return prior;
  }
}
