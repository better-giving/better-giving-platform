import type { IReg } from "@/reg";

/** not yet decided, and with the bank account wise returned when it carries
 * one — approval reads it (`$verdict/npo-new.ts`); a stripe-only application
 * has none to read. the detail page's Approve and the approve prompt's loader
 * both hold to it */
export const is_approvable = (
  reg: Pick<IReg, "status" | "o_bank_id" | "o_stripe_account_id">,
  account: object | null
) =>
  reg.status !== "03" &&
  reg.status !== "04" &&
  (account !== null || is_stripe_only(reg));

export const is_stripe_only = (
  reg: Pick<IReg, "o_bank_id" | "o_stripe_account_id">
) => !reg.o_bank_id && !!reg.o_stripe_account_id;
