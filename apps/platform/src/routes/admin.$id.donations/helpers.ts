import { type IAllocation, is_reversed } from "@/donations";
import { via_name } from "@/donations/helpers";
import { routed_kind, type TRoutedKind } from "@/stripe-connect/sent";
import type { INpoDonation } from "$/pg/queries/dist";

export function origin_text(source: string): string {
  if (source === "bg-widget") return "Donation Form";
  return "Marketplace";
}

export interface IFees {
  base: number;
  fsa: number;
  processing: number;
  processing_allowance: number;
}

/** where a stripe-routed dist's net went; a routed dist stores `ALL_CASH`,
 * so its allocation would read as a grant to the bank */
export type TStripePayout = TRoutedKind;

const stripe_payout_of = (
  x: INpoDonation,
  cancelled: boolean
): TStripePayout | undefined => {
  if (!x.stripe_routed_to) return undefined;
  return routed_kind({
    transfer_id: x.stripe_transfer_id,
    reversed: is_reversed(x.status),
    // kept and repaid read "Refunded", and a cancelled duplicate made no refund
    kept: !cancelled && x.owed_back,
    owing: x.owed_open,
    routed_at: x.date_created,
  });
};

export interface IRow {
  id: string;
  date: string;
  currency: string;
  amount: number;
  amount_usd: number;
  net_usd: number;
  fees: IFees;
  fee_base: number;
  fee_fsa: number;
  fee_processing: number;
  fee_covered_by_donor: boolean;
  payment_method: string;
  frequency: string;
  program_name: string;
  donation_origin: string;
  donation_origin_id: string;
  donation_origin_tag: string;
  donor_name: string;
  donor_email: string;
  donor_company: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  program_id: string;
  recipient_id: number;
  allocation?: IAllocation;
  status?: "settled" | "refunded" | "refunded_loss";
  /** a reversed duplicate: its dist reads `refunded`, but no refund was made.
   * a `refunded_loss` dist under a cancelled donation did refund, so is not */
  cancelled?: boolean;
  stripe_payout?: TStripePayout;
}

export const to_csv_row = (x: INpoDonation): IRow => {
  const fees: IFees = {
    base: x.fee_base ?? 0,
    fsa: x.fee_fsa ?? 0,
    processing: x.fee_processing ?? 0,
    processing_allowance: x.fee_allowance ?? 0,
  };

  const cancelled =
    x.status === "refunded" && x.donation_status === "cancelled";

  const row: IRow = {
    id: x.sttl_id ?? x.id,
    date: x.sttl_date ?? x.date_created,
    currency: x.amount_denom,
    amount: x.amount ?? 0,
    amount_usd: x.amount_usd ?? 0,
    net_usd: x.net ?? 0,
    fees,
    fee_base: fees.base,
    fee_fsa: fees.fsa,
    fee_processing: fees.processing,
    fee_covered_by_donor: fees.processing_allowance > 0,
    payment_method: via_name(x.via),
    frequency: x.frequency,
    program_name: x.program_name ?? "",
    donation_origin: origin_text(x.source),
    donation_origin_id: x.form_id ?? "",
    donation_origin_tag: x.form_tag || x.form_name || "",

    donor_name: x.from_name ?? "",
    donor_email: x.from_email,
    donor_company: x.from_company ?? "",
    street: x.from_addr?.street ?? "",
    city: x.from_addr?.city ?? "",
    state: x.from_addr?.state ?? "",
    zip_code: x.from_addr?.zip_code ?? "",
    country: x.from_addr?.country ?? "",
    program_id: x.program_id ?? "",
    recipient_id: x.to_id ?? 0,
    allocation: x.alloc ?? undefined,
    status: x.status,
    cancelled,
    stripe_payout: stripe_payout_of(x, cancelled),
  };
  return row;
};

export const to_row = (x: INpoDonation): IRow => {
  const base = to_csv_row(x);
  return {
    ...base,
    donation_origin: x.source,
    program_id: x.program_id ?? "",
    recipient_id: x.to_id ?? 0,
    allocation: x.alloc ?? undefined,
  };
};
