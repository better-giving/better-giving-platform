import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";

/** under review, with the account wise returned for the reviewer to check,
 * and not one of our own: the detail page's Approve and the approve route's
 * loader both hold to it */
export const is_approvable = (
  d: Pick<LoaderData, "ba" | "wacc_unavailable"> &
    Partial<Pick<LoaderData, "own_account">>
) => d.ba.status === "under-review" && !d.wacc_unavailable && !d.own_account;
