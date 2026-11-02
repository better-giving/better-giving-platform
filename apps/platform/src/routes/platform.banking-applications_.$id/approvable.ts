import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";

/** under review, with the account wise returned for the reviewer to check —
 * the detail page's Approve and the approve route's loader both hold to it */
export const is_approvable = (d: Pick<LoaderData, "ba" | "wacc_unavailable">) =>
  d.ba.status === "under-review" && !d.wacc_unavailable;
