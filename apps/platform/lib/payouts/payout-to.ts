import {
  connect_ineligibility,
  is_routable,
  routing_npo,
} from "../stripe-connect/eligibility";

/** where the balance goes: the bank, a stripe account (which takes stripe
 * donations only, and only once ready), or nowhere until a bank is added */
export type TPayoutTo =
  | { kind: "bank"; summary: string }
  | { kind: "stripe"; ready: boolean }
  | { kind: "none" };

type TRoutingRow = Parameters<typeof routing_npo>[0];

/** stripe as it stands in for a missing bank: `linked` at any readiness, or
 * `disconnected` by the npo since. null where it never could: no account,
 * routing off, or an npo stripe can't pay. Banking, Payouts and the dashboard
 * all read it, so the three agree on one npo
 * @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
export const stripe_standing = (
  npo: TRoutingRow | undefined,
  routing_on: boolean
): "linked" | "disconnected" | null => {
  if (!routing_on || !npo?.stripe_account_id) return null;
  if (connect_ineligibility(npo)) return null;
  return npo.stripe_deauthorized_at ? "disconnected" : "linked";
};

/** @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
export const payout_to = (
  bank: { bank_summary: string } | undefined,
  npo: TRoutingRow | undefined,
  routing_on: boolean
): TPayoutTo => {
  if (bank) return { kind: "bank", summary: bank.bank_summary };
  if (!npo || stripe_standing(npo, routing_on) !== "linked") {
    return { kind: "none" };
  }
  return { kind: "stripe", ready: is_routable(routing_npo(npo), routing_on) };
};
