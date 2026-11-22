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

/** a group with this many values or more collapses to one chip */
export const COLLAPSE_AT = 4;

export interface IChip {
  group: "status" | "method";
  /** the value this chip removes; null on a collapsed or All chip, which
   *  resets its whole group */
  value: string | null;
  label: string;
  /** "Status:" or "Method:", on the first chip of each group */
  prefix?: string;
  /** the × button's value in "Remove filter: {name}" */
  name: string;
}

const group_chips = (
  group: IChip["group"],
  head: string,
  values: { value: string; label: string }[],
  all_label?: string
): IChip[] => {
  const prefix = `${head}:`;
  if (all_label)
    return [
      {
        group,
        value: null,
        label: all_label,
        prefix,
        name: `${prefix} ${all_label}`,
      },
    ];
  if (values.length >= COLLAPSE_AT) {
    const label = `${values.length} selected`;
    return [{ group, value: null, label, prefix, name: `${prefix} ${label}` }];
  }
  return values.map((v, i) => ({
    group,
    value: v.value,
    label: v.label,
    prefix: i === 0 ? prefix : undefined,
    name: v.label,
  }));
};

/** the removable chips of the active filters: Status chips, then Method
 *  chips; none while both are on their defaults. Settled gets a chip
 *  whenever Status is off its default, so every ticked status is visible */
export const filter_chips = (s: StatusKey[], m: MethodKey[]): IChip[] => {
  const status =
    status_param(s) === null
      ? []
      : group_chips(
          "status",
          "Status",
          s.map((k) => ({ value: k, label: status_label(k) ?? k })),
          s.length === STATUS_KEYS.length ? STATUS_ALL_LABEL : undefined
        );
  const method =
    method_param(m) === null
      ? []
      : group_chips(
          "method",
          "Method",
          m.map((k) => ({ value: k, label: method_label(k) ?? k }))
        );
  return [...status, ...method];
};

/** the group after its chip's × : the value gone, or the whole group reset.
 *  an emptied Status returns to Settled and an emptied Method to no filter */
export const without_status = (
  sel: StatusKey[],
  value: string | null
): StatusKey[] => {
  const next = value === null ? [] : sel.filter((k) => k !== value);
  return next.length ? next : [...DEFAULT_STATUS];
};

export const without_method = (
  sel: MethodKey[],
  value: string | null
): MethodKey[] => (value === null ? [] : sel.filter((k) => k !== value));

export type Group = Exclude<MethodKey, "other">;

export type ViaGroup = Group | "other";
/** the group of a `via`, for the row tag; mirrors `GROUP_SQL` */
export const via_group = (v: string): ViaGroup => {
  if (v === "stripe" || v.startsWith("stripe:")) return "stripe";
  if (v.startsWith("paypal") || v === "venmo") return "paypal";
  if (v.startsWith("chariot") || v === "daf") return "daf";
  if (v.startsWith("crypto:")) return "crypto";
  if (v === "stocks") return "stocks";
  if (v === "match") return "match";
  return "other";
};
