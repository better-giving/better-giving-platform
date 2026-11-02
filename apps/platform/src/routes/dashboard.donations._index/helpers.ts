import type { TStatus } from "@/donations";
import { via_name } from "@/donations/helpers";
import type { IUserDonation } from "$/pg/queries/donation";

export interface IRow {
  id: string;
  date: string;
  status: TStatus;
  currency: string;
  amount: number;
  usd_value: number;
  payment_method: string;
  frequency: string;
  recipient_id: string;
  recipient_name: string;
  recipient_type: "npo" | "fund";
  program_id?: string;
  program_name?: string;
  via_id: string;
  via_extra?: string;
}

export const to_row = (x: IUserDonation): IRow => ({
  id: x.id,
  date: new Date(x.created_at).toLocaleDateString(),
  status: x.status as TStatus,
  currency: x.currency,
  amount: x.amount_base,
  usd_value: x.upusd > 0 ? x.amount_base / x.upusd : 0,
  recipient_id: x.recipient_id,
  recipient_name: x.recipient_name,
  recipient_type: x.recipient_type,
  payment_method: via_name(x.via),
  frequency: x.frequency,
  program_id: x.program_id ?? undefined,
  program_name: x.program_name ?? undefined,
  via_id: x.via,
  via_extra: x.via_extra ?? undefined,
});

/** human-readable status labels */
const status_labels: Record<TStatus, string> = {
  created: "Created",
  intent: "Awaiting payment",
  expired: "Expired",
  confirmed: "Confirmed",
  settled: "Settled",
  failed: "Failed",
  refunded: "Refunded",
  refunded_loss: "Refunded",
  cancelled: "Cancelled",
};

export function status_label(s: TStatus): string {
  return status_labels[s] ?? s;
}

const status_text_colors: Record<TStatus, string> = {
  settled: "text-success-subtle-fg",
  refunded: "text-destructive-subtle-fg",
  intent: "text-warning-subtle-fg",
  confirmed: "text-primary",
  created: "text-gray-11",
  expired: "text-gray-11",
  failed: "text-destructive-subtle-fg",
  refunded_loss: "text-destructive-subtle-fg",
  cancelled: "text-gray-11",
};

export function status_text_color(s: TStatus): string {
  return status_text_colors[s] ?? "text-gray-11";
}
