/** the status tabs, in display order. `statuses` is the `donations.status`
 *  set a tab lists; `all` carries none and so applies no filter. */
export const STATUS_OPTIONS = [
  { value: "settled", label: "Settled", statuses: ["settled"] },
  {
    value: "awaiting",
    label: "Awaiting funds",
    statuses: ["intent", "confirmed"],
  },
  { value: "unpaid", label: "Unpaid checkout", statuses: ["created"] },
  {
    value: "refunded",
    label: "Refunded",
    statuses: ["refunded", "refunded_loss"],
  },
  { value: "failed", label: "Failed", statuses: ["failed"] },
  {
    value: "closed",
    label: "Expired or cancelled",
    statuses: ["expired", "cancelled"],
  },
  { value: "all", label: "All", statuses: [] },
] as const;

export type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];
export const DEFAULT_STATUS: StatusFilter = "settled";

export const METHOD_OPTIONS = [
  { value: "all", label: "All" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "daf", label: "DAF" },
  { value: "crypto", label: "Crypto" },
  { value: "stocks", label: "Stocks" },
  { value: "match", label: "Employer match" },
  { value: "other", label: "Other" },
] as const;

export type MethodFilter = (typeof METHOD_OPTIONS)[number]["value"];
export const DEFAULT_METHOD: MethodFilter = "all";

/** a value the page doesn't list falls back to the default */
export const parse_status = (v: string | null): StatusFilter =>
  STATUS_OPTIONS.find((o) => o.value === v)?.value ?? DEFAULT_STATUS;

export const parse_method = (v: string | null): MethodFilter =>
  METHOD_OPTIONS.find((o) => o.value === v)?.value ?? DEFAULT_METHOD;

export type Group = Exclude<MethodFilter, "all" | "other">;

/** the group of a `via`, for the row tag; mirrors `GROUP_SQL` */
export type ViaGroup = Group | "other";
export const via_group = (v: string): ViaGroup => {
  if (v === "stripe" || v.startsWith("stripe:")) return "stripe";
  if (v.startsWith("paypal") || v === "venmo") return "paypal";
  if (v.startsWith("chariot") || v === "daf") return "daf";
  if (v.startsWith("crypto:")) return "crypto";
  if (v === "stocks") return "stocks";
  if (v === "match") return "match";
  return "other";
};
