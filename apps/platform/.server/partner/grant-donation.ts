import { eq } from "drizzle-orm";
import type { Db } from "../pg/db";
import { partner_payments } from "../pg/schema/partner";

/** the donation a partner's DAF payment made for a Chariot grant, null when no
 * partner payment holds the grant. a partner's connect element is mounted
 * before any payment exists, so its grant carries no `don_id` and the grant id
 * is the only way back to the row */
export async function partner_donation_of_grant(
  db: Db,
  grant_id: string
): Promise<string | null> {
  const [row] = await db
    .select({ donation_id: partner_payments.donation_id })
    .from(partner_payments)
    .where(eq(partner_payments.grant_id, grant_id));
  return row?.donation_id ?? null;
}
