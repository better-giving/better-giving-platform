import type { IPayout, PayoutStatus } from "@/payouts";
import type { payouts } from "../../schema/payout";

type PayoutRow = typeof payouts.$inferSelect;
type PayoutInsert = typeof payouts.$inferInsert;

export function to_payout(row: PayoutRow): IPayout {
  const base = {
    id: row.id,
    source_id: row.source_id,
    npo_id: row.npo_id,
    source: row.source,
    date: row.date,
    amount: row.amount,
  };

  switch (row.type) {
    case "settled":
      return {
        ...base,
        type: "settled",
        settled_date: row.settled_date ?? "",
        settled_id: row.settled_id ?? "",
      };
    case "error":
      return {
        ...base,
        type: "error",
        message: row.message ?? "",
      };
    case "refunded":
      return { ...base, type: "refunded" };
    case "refunded_loss":
      return { ...base, type: "refunded_loss" };
    case "cancelled":
      return { ...base, type: "cancelled" };
    case "processing":
      return { ...base, type: "processing", ref: row.message ?? "" };
    case "returned":
      return { ...base, type: "returned" };
    case "void":
      return { ...base, type: "void" };
    case "pending":
      return { ...base, type: "pending" };
    default: {
      // a type the union gains fails to compile here, not reads as pending
      const unmapped: never = row.type;
      throw new Error(`payout ${row.id} has unmapped type ${unmapped}`);
    }
  }
}

/** `message` is status-owned: an error's text or a claim's ref, cleared by any other status */
function status_message(s: PayoutStatus): string | null {
  if (s.type === "error") return s.message ?? null;
  if (s.type === "processing") return s.ref ?? null;
  return null;
}

export function from_payout_insert(data: IPayout): PayoutInsert {
  return {
    id: data.id,
    source_id: data.source_id,
    npo_id: data.npo_id,
    source: data.source,
    date: data.date,
    amount: data.amount,
    type: data.type,
    message: status_message(data),
    settled_date: data.type === "settled" ? data.settled_date : null,
    settled_id: data.type === "settled" ? data.settled_id : null,
  };
}

export function from_payout_update(
  data: Partial<Omit<IPayout, "id">>
): Partial<Omit<PayoutInsert, "id">> {
  const out: Record<string, unknown> = {};
  if (data.source_id !== undefined) out.source_id = data.source_id;
  if (data.npo_id !== undefined) out.npo_id = data.npo_id;
  if (data.source !== undefined) out.source = data.source;
  if (data.date !== undefined) out.date = data.date;
  if (data.amount !== undefined) out.amount = data.amount;
  if (data.type !== undefined) {
    out.type = data.type;
    out.message = status_message(data as PayoutStatus);
    if (data.type === "settled") {
      out.settled_date =
        (data as { settled_date?: string }).settled_date ?? null;
      out.settled_id = (data as { settled_id?: string }).settled_id ?? null;
    }
  }
  return out as Partial<Omit<PayoutInsert, "id">>;
}
