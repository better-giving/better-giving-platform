import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { numeric_as_number, timestamptz } from "./columns";
import { npos } from "./npo";

export const referrer_commissions = pgTable(
  "referrer_commissions",
  {
    referrer_user: text("referrer_user").references(() => user.referral_code),
    referrer_npo: text("referrer_npo").references(() => npos.referral_id),
    date: timestamptz("date").notNull(),
    donation_id: text("donation_id").notNull().primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id),
    amount: numeric_as_number("amount", { precision: 38, scale: 18 }).notNull(),
    status: text("status")
      .$type<
        | "pending"
        | "processing"
        | "paid"
        | "returned"
        | "refunded"
        | "refunded_loss"
      >()
      .notNull(),
    /** wise customerTransactionId of the transfer that claimed it */
    ref: text("ref"),
  },
  (t) => [
    check(
      "referrer_xor",
      sql`num_nonnulls(${t.referrer_user}, ${t.referrer_npo}) = 1`
    ),
    check(
      "status_check",
      sql`${t.status} IN ('pending','processing','paid','returned','refunded','refunded_loss')`
    ),
    index("referrer_commissions_donation_id_idx").on(t.donation_id),
    index("referrer_commissions_status_idx").on(t.status),
    index("referrer_commissions_referrer_user_npo_id_idx").on(
      t.referrer_user,
      t.npo_id
    ),
    index("referrer_commissions_referrer_npo_npo_id_idx").on(
      t.referrer_npo,
      t.npo_id
    ),
  ]
);

export const referrer_payouts = pgTable(
  "referrer_payouts",
  {
    referrer_user: text("referrer_user").references(() => user.referral_code),
    referrer_npo: text("referrer_npo").references(() => npos.referral_id),
    date: timestamptz("date").notNull(),
    id: text("id").primaryKey(),
    amount: numeric_as_number("amount", { precision: 38, scale: 18 }).notNull(),
    error: text("error"),
    transfer_id: bigint("transfer_id", { mode: "number" }),
    /** the transfer's wise state, stored by the returns poll (`returned` once
     * its money came back); empty until polled, and on rows with no transfer */
    status: text("status").notNull().default(""),
    /** the wise recipient the transfer paid, to tell a new payout account from
     * the one that bounced; null on a run from before it was stored */
    recipient_id: text("recipient_id"),
  },
  (t) => [
    check(
      "referrer_xor",
      sql`num_nonnulls(${t.referrer_user}, ${t.referrer_npo}) = 1`
    ),
  ]
);
