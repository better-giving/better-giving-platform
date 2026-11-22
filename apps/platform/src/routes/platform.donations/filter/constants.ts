/** the status groups, in display order. `statuses` is the `donations.status`
 *  set a group lists. */
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
] as const;

export type StatusKey = (typeof STATUS_OPTIONS)[number]["value"];
const STATUS_KEYS: StatusKey[] = STATUS_OPTIONS.map((o) => o.value);
export const DEFAULT_STATUS: StatusKey[] = ["settled"];

export const METHOD_OPTIONS = [
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "daf", label: "DAF" },
  { value: "crypto", label: "Crypto" },
  { value: "stocks", label: "Stocks" },
  { value: "match", label: "Employer match" },
  { value: "other", label: "Other" },
] as const;

export type MethodKey = (typeof METHOD_OPTIONS)[number]["value"];
const METHOD_KEYS: MethodKey[] = METHOD_OPTIONS.map((o) => o.value);
/** no method filter */
export const DEFAULT_METHOD: MethodKey[] = [];

/** the keys of `all` named in `raw` (comma list), trimmed, lowercased, unknown
 *  values dropped, de-duplicated and in option order */
const pick = <K extends string>(raw: string | null, all: K[]): K[] => {
  const named = new Set(
    (raw ?? "").split(",").map((v) => v.trim().toLowerCase())
  );
  return all.filter((k) => named.has(k));
};

/** `all` or every group is every status; an empty list is the default */
export const parse_status = (raw: string | null): StatusKey[] => {
  const named = (raw ?? "").split(",").map((v) => v.trim().toLowerCase());
  if (named.includes("all")) return [...STATUS_KEYS];
  const keys = pick(raw, STATUS_KEYS);
  return keys.length ? keys : [...DEFAULT_STATUS];
};

/** an empty list, `all`, or every method is no filter, as an empty list */
export const parse_method = (raw: string | null): MethodKey[] => {
  const named = (raw ?? "").split(",").map((v) => v.trim().toLowerCase());
  if (named.includes("all")) return [];
  const keys = pick(raw, METHOD_KEYS);
  return keys.length === METHOD_KEYS.length ? [] : keys;
};

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** the url value of a status list; null when it is the default (omitted) */
export const status_param = (sel: StatusKey[]): string | null => {
  if (sel.length === STATUS_KEYS.length) return "all";
  return same(sel, DEFAULT_STATUS) || sel.length === 0 ? null : sel.join(",");
};

export const method_param = (sel: MethodKey[]): string | null =>
  sel.length === 0 || sel.length === METHOD_KEYS.length ? null : sel.join(",");

export const is_default_filter = (s: StatusKey[], m: MethodKey[]) =>
  status_param(s) === null && method_param(m) === null;

export const STATUS_ALL_LABEL = "All statuses";
export const METHOD_ALL_LABEL = "All methods";

const status_label = (k: StatusKey) =>
  STATUS_OPTIONS.find((o) => o.value === k)?.label;
const method_label = (k: MethodKey) =>
  METHOD_OPTIONS.find((o) => o.value === k)?.label;

/** one or two values by name, three or more as a count */
const list = (labels: (string | undefined)[], noun: string) =>
  labels.length <= 2 ? labels.join(", ") : `${labels.length} ${noun}`;

/** the "Showing:" line */
export const status_summary = (sel: StatusKey[]) =>
  sel.length === STATUS_KEYS.length
    ? STATUS_ALL_LABEL
    : list(sel.map(status_label), "statuses");

export const method_summary = (sel: MethodKey[]) =>
  sel.length === 0 ? METHOD_ALL_LABEL : list(sel.map(method_label), "methods");

/** a header button's accessible name: values by name up to two, then a count */
export const status_name = (sel: StatusKey[]) =>
  `Status filter: ${
    sel.length === STATUS_KEYS.length
      ? STATUS_ALL_LABEL
      : sel.length >= 3
        ? `${sel.length} selected`
        : sel.map(status_label).join(", ")
  }`;

export const method_name = (sel: MethodKey[]) =>
  `Method filter: ${
    sel.length === 0
      ? METHOD_ALL_LABEL
      : sel.length >= 3
        ? `${sel.length} selected`
        : sel.map(method_label).join(", ")
  }`;

/** the 375 chip's value: one by name, two or more as a count, every status as All */
export const status_chip = (sel: StatusKey[]) =>
  sel.length === STATUS_KEYS.length
    ? "All"
    : sel.length === 1
      ? (status_label(sel[0]!) ?? "")
      : String(sel.length);

export const method_chip = (sel: MethodKey[]) =>
  sel.length === 0
    ? "All"
    : sel.length === 1
      ? (method_label(sel[0]!) ?? "")
      : String(sel.length);

export type Group = Exclude<MethodKey, "other">;

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
