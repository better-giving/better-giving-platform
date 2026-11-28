import { eq, or } from "drizzle-orm";
import type { Db } from "../pg/db";
import { partner_payments } from "../pg/schema/partner";

/** the donation a partner's DAF payment holds for a Chariot grant, null when
 * no partner payment does. a partner's connect element is mounted before any
 * payment exists, so its grant carries no `don_id`: the grant id is the way
 * back, and the Connect session the payment was authorized by is the way when
 * the grant was made but its id never written down */
export async function partner_donation_of_grant(
  db: Db,
  grant_id: string,
  session_id?: string
): Promise<string | null> {
  const [row] = await db
    .select({ donation_id: partner_payments.donation_id })
    .from(partner_payments)
    .where(
      session_id
        ? or(
            eq(partner_payments.grant_id, grant_id),
            eq(partner_payments.authorized_session_id, session_id)
          )
        : eq(partner_payments.grant_id, grant_id)
    );
  return row?.donation_id ?? null;
}
