import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { PayoutStatus, TSource } from "@/payouts";
import { numeric_as_number, timestamptz, timestamptz_now } from "./columns";
import { npos } from "./npo";

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    source_id: text("source_id").notNull(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id),
    source: text("source").$type<TSource>().notNull(),
    date: timestamptz("date").notNull(),
    amount: numeric_as_number("amount", { precision: 38, scale: 18 }).notNull(),
    type: text("type").$type<PayoutStatus["type"]>().notNull(),
    message: text("message"),
    settled_date: timestamptz("settled_date"),
    settled_id: text("settled_id").references(
      (): AnyPgColumn => settlements.id
    ),
  },
  (t) => [
    check("source_check", sql`${t.source} IN ('donation','liq','lock')`),
    check("amount_check", sql`${t.amount} > 0`),
    check(
      "type_check",
      sql`${t.type} IN ('pending','processing','settled','error','refunded','refunded_loss','cancelled','returned','bounced','void')`
    ),
    index("payouts_npo_id_date_idx").on(t.npo_id, t.date),
    index("payouts_type_date_idx").on(t.type, t.date),
  ]
);

export const settlements = pgTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    other_id: text("other_id"),
    npo_id: integer("npo_id").references(() => npos.id),
    date: timestamptz("date").notNull(),
    amount: numeric_as_number("amount", { precision: 38, scale: 18 }).notNull(),
    sources: text("sources").array(),
    /** the transfer's wise state (`returned` once its money came back) */
    status: text("status").notNull(),
    /** when ops was told this npo's payouts are held after a return: once */
    hold_alerted_at: timestamptz("hold_alerted_at"),
    /** the wise recipient the transfer paid (the banking app id; wise's
     * `targetAccount`): what a return hold compares the npo's current account
     * with. null on a run from before it was stored, until a poll reads it */
    recipient_id: text("recipient_id"),
  },
  (t) => [index("settlements_npo_id_date_idx").on(t.npo_id, t.date)]
);

export const MANUAL_WIRES_PROVIDER_TX_UNIQ = "manual_wires_provider_tx_uniq";

/** a wire sent by hand to an npo paid by `manual_wire`; the settlement that
 * records it settles that npo's pending payouts */
export const manual_wires = pgTable(
  "manual_wires",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id),
    /** one of `WIRE_PROVIDERS` when recorded; not a check, so a provider
     * retired from the list keeps its history */
    provider: text("provider").notNull(),
    /** the provider's own reference for the wire */
    provider_tx_id: text("provider_tx_id").notNull(),
    wire_date: date("wire_date", { mode: "string" }).notNull(),
    /** what reached the npo's bank: the settlement's net less `wire_fee` */
    amount_sent: numeric_as_number("amount_sent", {
      precision: 38,
      scale: 18,
    }).notNull(),
    /** the provider's fee, paid by the npo out of the net */
    wire_fee: numeric_as_number("wire_fee", {
      precision: 38,
      scale: 18,
    }).notNull(),
    settlement_id: text("settlement_id")
      .notNull()
      .unique("manual_wires_settlement_id_uniq")
      .references(() => settlements.id),
    created_at: timestamptz_now("created_at"),
  },
  (t) => [
    unique(MANUAL_WIRES_PROVIDER_TX_UNIQ).on(t.provider, t.provider_tx_id),
    check("manual_wires_amount_sent_check", sql`${t.amount_sent} > 0`),
    check("manual_wires_wire_fee_check", sql`${t.wire_fee} >= 0`),
    check(
      "manual_wires_provider_tx_id_check",
      sql`btrim(${t.provider_tx_id}) <> ''`
    ),
  ]
);
