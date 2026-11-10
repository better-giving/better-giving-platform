import {
  array,
  boolean,
  check,
  custom,
  excludes,
  type InferOutput,
  integer,
  lazy,
  length,
  literal,
  maxLength,
  minLength,
  minValue,
  nonEmpty,
  number,
  object,
  picklist,
  pipe,
  regex,
  someItem,
  string,
  transform,
  trim,
  union,
  url,
} from "valibot";
import { segment_block } from "./route-segments";

export const file_obj = object({
  name: string(),
  publicUrl: pipe(string(), url()),
});

export const org_designations = [
  "Charity",
  "Religious Organization",
  "University",
  "Hospital",
  "Other",
] as const;

export const org_designation = picklist(org_designations, "required");
export type OrgDesignation = InferOutput<typeof org_designation>;

const unsdg_nums = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
] as const;

export const unsdg_num = picklist(unsdg_nums);
export type UnSdgNum = InferOutput<typeof unsdg_num>;

const envs = ["staging", "production"] as const;
export const env = picklist(envs);
export type Environment = InferOutput<typeof env>;

const donate_method_ids = [
  "stripe",
  "stripe_bank",
  "daf",
  "stocks",
  "ira_qcd",
  "crypto",
] as const;
export const donate_method_id = picklist(donate_method_ids, "required");
export type DonateMethodId = InferOutput<typeof donate_method_id>;

export const $ = pipe(string("required"), trim());
export const $req = pipe($, nonEmpty("required"));

export const int_gte1 = pipe(number(), integer(), minValue(1));
export const $int_gte1 = pipe(
  $,
  transform((x) => +x),
  int_gte1
);

const num_gt0 = pipe(number(), minValue(0, "must be > 0"));

const $req_num_gt0 = pipe(
  $req,
  transform((x) => +x),
  num_gt0,
  transform((x) => x.toString())
);

export const $num_gt0_fn = ({
  required = false,
}: {
  required?: boolean;
} = {}) => {
  return lazy((x) => {
    if (!x && required) return $req;
    if (!x) return $;
    return $req_num_gt0;
  });
};

export const https_url = (opts?: { required?: boolean }) => {
  return lazy((x) => {
    if (!x) return (opts?.required ?? false) ? $req : $;
    return pipe(
      $,
      transform((x) => (x.startsWith("https://") ? x : `https://${x}`)),
      url("invalid url")
    );
  });
};

const segment_max_chars = 30;
// charset and length only. a stored slug may already equal a route segment,
// and lookup still has to resolve it. `segment` adds that reservation.
export const segment_shape = pipe(
  $,
  maxLength(
    segment_max_chars,
    ({ requirement: r }) => `Use ${r} characters or fewer`
  ),
  //must not be id-like
  regex(/^(?!^\d+$)/, "Don't use only numbers"),
  //valid characters
  regex(
    /^[a-zA-Z0-9-._~]+$/,
    "Use only English letters (a-z), numbers, and - . _ ~"
  ),
  excludes("..", "Don't use two dots in a row"),
  custom((x) => {
    const v = x as string;
    return !v.startsWith(".") && !v.endsWith(".");
  }, "Don't start or end with a dot")
);

export const segment = pipe(
  segment_shape,
  custom(
    (x) => segment_block(x as string) === undefined,
    (issue) => segment_block(String(issue.input)) ?? "Pick a different slug"
  )
);

// shared with fund slugs. the route reservation is `org_slug` only.
export const slug = lazy((x) => (x ? segment_shape : $));
export const org_slug = lazy((x) => (x ? segment : $));

export const increment_label_max_chars = 60;
export const MAX_NUM_INCREMENTS = 4;

export const increment_label = pipe(
  $,
  maxLength(
    increment_label_max_chars,
    ({ requirement: r }) => `cannot exceed ${r} characters`
  )
);

export const increment_val = pipe(
  $req_num_gt0,
  //parsed output
  transform((x) => x.toString())
);

export const increment = object({
  value: increment_val,
  label: increment_label,
});

export interface IIncrement extends InferOutput<typeof increment> {}

export const target = union([
  literal("smart"),
  // "0" - none, `${number}` - fixed
  pipe(
    string(),
    transform((v) => +v),
    number(),
    minValue(0),
    transform((v) => v.toString())
  ),
]);

const frequencies = ["one-time", "monthly", "weekly", "annual"] as const;
export const frequency = picklist(
  frequencies,
  "Please select donation frequency"
);

export const donate_freq_opts = pipe(
  array(frequency),
  transform((x) => Array.from(new Set(x))),
  minLength(1, "at least one frequency must be selected"),
  check((x) => x.includes("one-time"), "should allow one-time donations")
);

export const donate_freq_opts_bool = pipe(
  array(boolean()),
  length(4, "should have four frequency options"),
  someItem((x) => x, "select at least one"),
  check(([one_time]) => one_time, "should allow one-time donations")
);

export type TFrequency = InferOutput<typeof frequency>;
