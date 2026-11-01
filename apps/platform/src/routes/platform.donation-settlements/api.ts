import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "$/pg/db";
import { decode_date_cursor, encode_date_cursor } from "$/pg/queries/helpers";
import {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { searchParams: s } = url;
  const cursor = s.get("cursor") || undefined;
  const limit = 20;

  const decoded = decode_date_cursor(cursor);

  const rows = await db
    .select({
      donation_id: donations.id,
      created_at: donations.created_at,
      donor_name: donation_donors.name,
      donor_email: donation_donors.email,
      npo_name: npos.name,
      net: donation_settlements.net,
      reference: donations.via_extra,
      via: donations.via,
    })
    .from(donations)
    .leftJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    .leftJoin(
      donation_recipients,
      eq(donations.id, donation_recipients.donation_id)
    )
    .leftJoin(npos, eq(donation_recipients.npo_id, npos.id))
    .leftJoin(
      donation_settlements,
      eq(donations.id, donation_settlements.donation_id)
    )
    .where(
      and(
        inArray(donations.via, ["cheque", "daf", "stocks"]),
        decoded ? sql`${donations.created_at} < ${decoded}` : undefined
      )
    )
    .orderBy(desc(donations.created_at))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);

  return {
    settlements: items,
    has_more,
    next_cursor: has_more
      ? (encode_date_cursor(items[items.length - 1]?.created_at) ?? null)
      : null,
  };
};
