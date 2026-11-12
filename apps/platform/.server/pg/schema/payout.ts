import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { PayoutStatus, TSource } from "@/payouts";
import { numeric_as_number, timestamptz } from "./columns";
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
      sql`${t.type} IN ('pending','processing','settled','error','refunded','refunded_loss','cancelled','returned','void')`
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
  },
  (t) => [index("settlements_npo_id_date_idx").on(t.npo_id, t.date)]
);
