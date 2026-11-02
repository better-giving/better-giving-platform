import type { IReg } from "@/reg";

/** not yet decided, with the bank account wise returned — approval reads it
 * (`$verdict/npo-new.ts`). the detail page's Approve and the approve prompt's
 * loader both hold to it */
export const is_approvable = (
  reg: Pick<IReg, "status">,
  account: object | null
) => reg.status !== "03" && reg.status !== "04" && account !== null;
