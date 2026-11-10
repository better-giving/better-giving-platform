import { currency_precision } from "#/helpers/stripe";
import { currency_fv, type ICurrencyFv } from "#/types/currency";
import type { IDonorFv } from "@/donations/schema";
import { ru, ru_vdec, snap } from "@/helpers/decimal";
import type { DonateMethodId } from "@/npo";
import {
  $int_gte1,
  frequency,
  type IIncrement,
  type TFrequency,
} from "@/schemas";
import { amount_num, decimal_str } from "@/schemas/amount";

export type { IDonorFv, ITribute } from "@/donations/schema";

import * as v from "valibot";
import type { DonationSource } from "#/types/lists";

const uuid = v.pipe(v.string(), v.trim(), v.uuid());
const recipient_id = v.pipe(
  v.union([uuid, $int_gte1]),
  v.transform((x) => x.toString())
);
const donation_recipient = v.object({
  id: v.fallback(recipient_id, "1"),
  name: v.fallback(v.pipe(v.string(), v.nonEmpty()), "Better Giving"),
  /** int-str array */
  members: v.array(v.string()),
  hide_bg_tip: v.optional(v.boolean()),
  donor_address_required: v.union([v.boolean(), v.undefined()]),
});

export const is_fund = (recipient: string) => v.UUID_REGEX.test(recipient); //is uuid

export interface DonationRecipient
  extends v.InferOutput<typeof donation_recipient> {}

export const donation_recipient_init = (
  overrides?: Partial<DonationRecipient>
): DonationRecipient => {
  return {
    id: "1",
    name: "Better Giving",
    members: [],
    donor_address_required: false,
    ...overrides,
  };
};

export const amount = ({ required = false } = {}) =>
  v.lazy((x) => {
    if (!x && !required) return v.string();
    if (!x && required) {
      return v.pipe(v.string(), v.nonEmpty("Please enter an amount"));
    }
    return v.pipe(
      // no decimals cap here: the currency's or token's own precision is the
      // check that follows, with its own message
      amount_num(Number.POSITIVE_INFINITY),
      v.gtValue(0, "amount must be greater than 0"),
      v.transform(decimal_str)
    );
  });

const ticker_raw = v.object({
  symbol: v.pipe(v.string(), v.nonEmpty("select ticker")),
  amount: amount({ required: true }),

  // internal
  // 0 until the pick's estimate lands, and a quote of 0 is no price
  usdpu: v.pipe(v.number(), v.gtValue(0)),
  min: v.number(),
  name: v.string(),
});

const ticker_fv = v.pipe(
  ticker_raw,
  v.forward(
    v.partialCheck(
      [["amount"], ["min"], ["symbol"], ["usdpu"]],
      (i) => {
        if (!i.min) return true;
        return +i.amount >= i.min;
      },
      ({ input: i }) => `minimum of ${ru_vdec(i.min, i.usdpu)} ${i.symbol}`
    ),
    ["amount"]
  )
);

export interface ITickerFv extends v.InferOutput<typeof ticker_fv> {}

const token_raw = v.object({
  id: v.pipe(v.string(), v.nonEmpty("select token")),
  amount: amount({ required: true }),

  // internal
  name: v.string(),
  code: v.string(),
  min: v.number(),
  /**  usd/unit — 0 until the pick's estimate lands, and a quote of 0 is no price */
  usdpu: v.pipe(v.number(), v.gtValue(0)),
  logo: v.string(),
  precision: v.number(),
  network: v.string(),
  cg_id: v.string(),
  color: v.string(),
  symbol: v.string(),
});

export interface ITokenFv extends v.InferOutput<typeof token_raw> {}

const token_fv = v.pipe(
  token_raw,
  v.forward(
    v.partialCheck(
      [["amount"], ["min"], ["usdpu"], ["symbol"], ["precision"]],
      ({ amount, min }) => {
        if (!min) return true;
        return +amount >= min;
      },
      ({ input: i }) =>
        `minimum of ${ru_vdec(i.min, i.usdpu, i.precision)} ${i.symbol}`
    ),
    ["amount"]
  ),
  v.forward(
    v.partialCheck(
      [["amount"], ["precision"]],
      ({ amount, precision }) => {
        if (!amount) return true;
        const num_decimals = amount.toString().split(".").at(1)?.length ?? 0;
        return num_decimals <= precision;
      },
      (x) => too_precise(x.input.precision)
    ),
    ["amount"]
  )
);

export const tip_formats = ["10", "15", "20", "custom", "none"] as const;
const tip_format = v.picklist(tip_formats);

export type TTipFormat = (typeof tip_formats)[number];

const tip_fv = v.object({
  tip: amount(),
  tip_format,
});

type TipFv = v.InferOutput<typeof tip_fv>;

export const tip_fv_init: TipFv = {
  tip: "",
  tip_format: "none",
};

const is_tip_valid = (input: TipFv) => {
  if (input.tip_format !== "custom") return true;
  return +input.tip > 0;
};

export const tip_val = (
  format: TTipFormat,
  custom: string,
  amount: number
): number => {
  if (format === "custom") {
    return +custom;
  }
  if (format === "none") return 0;
  const pct = +format / 100;
  return pct * amount;
};

/**
 * the inverse of `tip_val`: recover a format from an amount already charged.
 * `value` is the tip, `base` the amount it was taken from.
 *
 * a recognised percentage pairs with `tip: ""` — the same convention
 * `tip_handlers` follows, since `tip_val` derives percentage tips and never
 * reads the string.
 */
export const tip_from_val = (
  value: number,
  base: number
): { tip_format: TTipFormat; tip: string } => {
  const pct = value / base;
  if (Math.abs(pct - 0.15) < 0.001) return { tip_format: "15", tip: "" };
  if (Math.abs(pct - 0.2) < 0.001) return { tip_format: "20", tip: "" };
  if (Math.abs(pct - 0.1) < 0.001) return { tip_format: "10", tip: "" };
  return { tip_format: "custom", tip: value.toString() };
};

/** at most `precision` decimals, the most the charge can carry */
const is_within_precision = (amount: string, precision: number) =>
  !amount || Number.isInteger(snap(+amount * 10 ** precision));

const too_precise = (precision: number) =>
  precision === 0
    ? "must be a whole number"
    : `can't be more than ${precision} decimals`;

const is_min_met = (input: { amount: string; currency: ICurrencyFv }) => {
  if (!input.currency.min) return true;
  return +input.amount >= input.currency.min;
};

const crypto_donation_raw = v.object({
  token: token_fv,
  ...tip_fv.entries,
  cover_processing_fee: v.boolean(),
});

export type CryptoDonationDetails = v.InferOutput<typeof crypto_donation_raw>;
export const crypto_donation_details = v.pipe(
  crypto_donation_raw,
  v.forward(
    v.partialCheck([["tip"], ["tip_format"]], is_tip_valid, "required"),
    ["tip"]
  )
);

const stripe_donation_details_raw = v.object({
  amount: amount({ required: true }),
  currency: currency_fv,
  frequency,
  ...tip_fv.entries,
  cover_processing_fee: v.boolean(),
});

export interface StripeDonationDetails
  extends v.InferOutput<typeof stripe_donation_details_raw> {}

export const stripe_donation_details = v.pipe(
  stripe_donation_details_raw,
  v.forward(
    v.partialCheck(
      [["amount"], ["currency"]],
      is_min_met,
      ({ input: i }) =>
        `minimum of ${ru(i.currency.min, currency_precision(i.currency.code))} ${i.currency.code}`
    ),
    ["amount"]
  ),
  v.forward(
    v.partialCheck(
      [["amount"], ["currency"]],
      ({ amount, currency }) =>
        is_within_precision(amount, currency_precision(currency.code)),
      ({ input: i }) => too_precise(currency_precision(i.currency.code))
    ),
    ["amount"]
  ),
  v.forward(
    v.partialCheck([["tip"], ["tip_format"]], is_tip_valid, "required"),
    ["tip"]
  )
);

const stocks_donation_details_raw = v.object({
  ticker: ticker_fv,
  ...tip_fv.entries,
});

export type StocksDonationDetails = v.InferOutput<
  typeof stocks_donation_details_raw
>;

export const stocks_donation_details = v.pipe(
  stocks_donation_details_raw,
  v.forward(
    v.partialCheck([["tip"], ["tip_format"]], is_tip_valid, "required"),
    ["tip"]
  )
);

const daf_donation_details_raw = v.object({
  amount: amount({ required: true }),
  ...tip_fv.entries,
  cover_processing_fee: v.boolean(),
});

export interface DafDonationDetails
  extends v.InferOutput<typeof daf_donation_details_raw> {}

export const daf_donation_details = v.pipe(
  daf_donation_details_raw,
  v.forward(
    v.partialCheck(
      [["amount"]],
      ({ amount }) => is_within_precision(amount, 0),
      "must be a whole dollar amount"
    ),
    ["amount"]
  ),
  v.forward(
    v.partialCheck([["tip"], ["tip_format"]], is_tip_valid, "required"),
    ["tip"]
  )
);

const ira_qcd_donation_details_raw = v.object({
  amount: amount({ required: true }),
  ...tip_fv.entries,
  custodian: v.optional(
    // mirrors api.donation-notifications, which refuses anything else
    v.pipe(
      v.string(),
      v.trim(),
      // ios smart punctuation
      v.transform((s) => s.replace(/[‘’]/g, "'")),
      v.maxLength(100, "Keep it to 100 characters"),
      v.regex(
        /^[\p{L}\d &'.,()*/-]*$/u,
        "Use letters, numbers, spaces and & ' . , ( ) * / - only"
      ),
      v.check(
        (s) => !/[\p{L}\d-]\.\p{L}{2,}/u.test(s),
        "Enter the firm's name, not a web address"
      )
    )
  ),
});

export type IraQcdDonationDetails = v.InferOutput<
  typeof ira_qcd_donation_details_raw
>;

export const ira_qcd_donation_details = v.pipe(
  ira_qcd_donation_details_raw,
  v.forward(
    v.partialCheck([["tip"], ["tip_format"]], is_tip_valid, "required"),
    ["tip"]
  )
);

export type Mode = "live" | "preview";

export type Config = {
  id: string | null;
  /** donation tabs follows the list order */
  method_ids?: DonateMethodId[];
  /** hex color without alpha */
  accent_primary?: string;
  /** hex color without alpha */
  accent_secondary?: string;
  increments?: IIncrement[];
  success_redirect: string | undefined;
  freq_opts: TFrequency[] | undefined;
  /** amount the form opens with, in usd; the stored row still carries it
   * under `defaults.stripe.amount_usd` and the loader flattens it here */
  prefill_amount_usd?: string;
  /** opening frequency when it is one of `freq_opts`; anything else is ignored */
  prefill_frequency?: TFrequency;
  /** set on a campaign page so the gift is attributed; absent on every other form */
  campaign_id?: string;
  /** public campaign address, for transfer instructions the donor copies */
  campaign_url?: string;
  /** campaign title on those instructions. the legal grantee stays recipient.name */
  campaign_name?: string;
  /** origin of the page framing this form, when its embed script told us.
   * already validated (see `common/parent-origin.ts`); absent means the
   * wildcard every embed used before the parameter existed. */
  parent_origin?: string;
};

export interface IProgram {
  id: string;
  name: string;
}

export interface IUser {
  email: string;
  first_name?: string;
  last_name?: string;
}

export type Init = {
  source: DonationSource;
  mode: Mode;
  recipient: DonationRecipient;
  program?: IProgram;
  config: Config | null;
  user?: IUser;
  base_url: string;
  /**
   * for mounts the visitor didn't come to donate on (a marketing page carrying
   * the form): when an express rail can't be offered at all — sdk blocked by an
   * adblocker/csp, no funding method eligible for the currency — drop the block
   * instead of announcing it in a modal over the page they were reading.
   * defaults to the donate-page behavior, which announces it. a payment that
   * fails **mid-flight** always announces itself, on every mount.
   */
  hide_unavailable_express?: boolean;
  /**
   * the card button is the main action and must not move once the form is
   * up. express wallets and their load failures render under it, behind an
   * "or", and that group stays collapsed until a wallet has actually drawn.
   * other donate pages leave this off and keep the wallets above the button.
   */
  wallets_below?: boolean;
  /**
   * stick the step's primary action to the bottom of the mount.
   * unset donate pages leave this off and keep their layout.
   */
  pin?: boolean;
};

export type TMethod =
  | "stripe"
  | "stripe_bank"
  | "crypto"
  | "stocks"
  | "daf"
  | "ira_qcd";

type TFV<T extends TMethod> = T extends "stripe"
  ? StripeDonationDetails
  : T extends "stripe_bank"
    ? StripeDonationDetails
    : T extends "crypto"
      ? CryptoDonationDetails
      : T extends "stocks"
        ? StocksDonationDetails
        : T extends "daf"
          ? DafDonationDetails
          : T extends "ira_qcd"
            ? IraQcdDonationDetails
            : never;

export type TMethodState<T extends TMethod> =
  | { type: T; step: "form"; fv?: TFV<T> }
  /** donor info is set shared among donate methods */
  | { type: T; step: "donor"; fv: TFV<T> }
  | { type: T; step: "checkout"; fv: TFV<T> };

export type TDonation = Init & {
  /** may be empty */
  donor: IDonorFv;
  method: TMethod;
} & {
  [method in TMethod]?: TMethodState<method>;
};

export type StateSetter = (
  new_state: TDonation | ((prev: TDonation) => TDonation)
) => void;

export type State = {
  don: TDonation;
  don_set: StateSetter;
  /** set while a payment's result is unknown. absent on mounts that never hold the dialog. */
  report_pay_busy?: (busy: boolean) => void;
  /** steps read this so Go Back cannot unmount the hold. */
  pay_busy?: boolean;
};

export const to_step = <T extends TMethod>(
  type: T,
  curr: TFV<T>,
  step: "form" | "donor" | "checkout",
  setter: StateSetter
) => {
  setter((x) => ({
    ...x,
    method: type,
    [type]: {
      type: type,
      step: step,
      fv: curr,
    },
  }));
};
