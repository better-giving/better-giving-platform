import type { IReg } from "@/reg";

/** not yet decided, and with the bank account wise returned when it carries
 * one — approval reads it (`$verdict/npo-new.ts`); a stripe-only application
 * has none to read, and approves only while routing is on, as the action's
 * `banking_with` holds it. the detail page's Approve and the approve prompt's
 * loader both hold to it
 * @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
export const is_approvable = (
  reg: Pick<IReg, "status" | "o_bank_id" | "o_stripe_account_id">,
  account: object | null,
  routing_on: boolean
) =>
  reg.status !== "03" &&
  reg.status !== "04" &&
  (account !== null || (routing_on && is_stripe_only(reg)));

export const is_stripe_only = (
  reg: Pick<IReg, "o_bank_id" | "o_stripe_account_id">
) => !reg.o_bank_id && !!reg.o_stripe_account_id;
