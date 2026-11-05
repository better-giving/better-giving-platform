import {
  connect_ineligibility,
  is_routable,
  routing_npo,
} from "@/stripe-connect/eligibility";

/** where the balance goes: the bank, a stripe account (which takes stripe
 * donations only, and only once ready), or nowhere until a bank is added */
export type TPayoutTo =
  | { kind: "bank"; summary: string }
  | { kind: "stripe"; ready: boolean }
  | { kind: "none" };

type TRoutingRow = Parameters<typeof routing_npo>[0];

/** @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
export const payout_to = (
  bank: { bank_summary: string } | undefined,
  npo: TRoutingRow | undefined,
  routing_on: boolean
): TPayoutTo => {
  if (bank) return { kind: "bank", summary: bank.bank_summary };
  const linked =
    !!npo?.stripe_account_id &&
    npo.stripe_deauthorized_at === null &&
    routing_on &&
    connect_ineligibility(npo) === null;
  if (!npo || !linked) return { kind: "none" };
  return { kind: "stripe", ready: is_routable(routing_npo(npo), routing_on) };
};
