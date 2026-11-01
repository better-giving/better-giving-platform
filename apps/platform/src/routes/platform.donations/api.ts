import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "$/pg/db";
import { decode_date_cursor, encode_date_cursor } from "$/pg/queries/helpers";
import {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} from "$/pg/schema/donation";
import { donation_match_events } from "$/pg/schema/match";
import { npos } from "$/pg/schema/npo";
import type { Route } from "./+types/route";

export interface PaymentRow {
  id: string;
  donation_id: string;
  amount_base: number;
  amount_tip: number;
  amount_fee_allowance: number;
  currency: string;
  email: string | null;
  company_name: string | null;
  npo_name: string | null;
  sttl_fee: number | null;
  sttl_currency: string | null;
  via: string;
  created_at: string;
  status: string;
  /** null when the donation never entered the match workflow — the one field
   * that separates "no event" from "an event with nothing stamped yet" */
  match_event_id: string | null;
  /** every stamp on the donation's match event; all null when it has none */
  match_pack_sent_at: string | null;
  match_chased_at: string | null;
  match_submitted_at: string | null;
  match_voided_at: string | null;
  match_void_reason: string | null;
  /** a mail this event lost — the only reader `send_failed_kind` has ever had */
  match_send_failed_kind: string | null;
}

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { searchParams: s } = url;
  const cursor = s.get("cursor") || undefined;
  const limit = 20;

  const decoded = decode_date_cursor(cursor);

  const rows = await db
    .select({
      id: donations.id,
      donation_id: donations.id,
      amount_base: donations.amount_base,
      amount_tip: donations.amount_tip,
      amount_fee_allowance: donations.amount_fee_allowance,
      currency: donations.currency,
      email: donation_donors.email,
      company_name: donation_donors.company_name,
      npo_name: npos.name,
      sttl_fee: donation_settlements.fee,
      sttl_currency: donation_settlements.currency,
      via: donations.via,
      created_at: donations.created_at,
      status: donations.status,
      match_event_id: donation_match_events.id,
      match_pack_sent_at: donation_match_events.pack_sent_at,
      match_chased_at: donation_match_events.chased_at,
      match_submitted_at: donation_match_events.submitted_at,
      match_voided_at: donation_match_events.voided_at,
      match_void_reason: donation_match_events.void_reason,
      match_send_failed_kind: donation_match_events.send_failed_kind,
    })
    .from(donations)
    .leftJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    // left: most donations have no match event, and they must still list — the
    // stamps read empty rather than dropping the row from the refund surface
    // this page already was.
    .leftJoin(
      donation_match_events,
      eq(donations.id, donation_match_events.donation_id)
    )
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
        inArray(donations.status, ["settled", "refunded", "refunded_loss"]),
        decoded ? sql`${donations.created_at} < ${decoded}` : undefined
      )
    )
    .orderBy(desc(donations.created_at))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);

  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.created_at)
      : undefined,
  };
};
