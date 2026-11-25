import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useForm } from "react-hook-form";
import { safeParse } from "valibot";
import { paypal_currencies } from "#/constants/paypal";
import { to_atomic_c } from "#/helpers/stripe";
import type { ICurrencyFv } from "#/types/currency";
import { rd } from "@/helpers/decimal";
import { min_fee_allowance } from "@/helpers/donation";
import type { TFrequency } from "@/schemas";
import {
  fee_terms,
  type IAmountsInput,
  stripe_amounts,
} from "../../common/amounts";
import type { OnIncrement } from "../../common/incrementers";
import {
  amount as amount_schema,
  type StripeDonationDetails as FV,
  stripe_donation_details,
  tip_val,
} from "../../types";

export interface ILineItem {
  name: string;
  amount_atomic: number;
}
export interface IStripeExpress {
  /** may be empty */
  frequency: TFrequency;
  total_usd: number;
  total_atomic: number;
  /** includes tip and fee_allowance */
  total: number;
  base: number;
  tip: number;
  fee_allowance: number;
  items: ILineItem[];
  currency: string;
  is_partial: boolean;
}

export interface IITem {
  name: string;
  amnt: string;
}

export interface IPayPalExpress {
  currency: string;
  frequency: TFrequency;
  amnt: number;
  tip: number;
  fee_allowance: number;
  is_partial: boolean;
}

/** the amount the express element mounts against before the donor has typed a
 * valid one. sits at the form's own minimum because stripe enforces a
 * per-currency floor we carry no table for, and 2 usd clears every documented
 * one. */
export const stripe_express_partial = (
  c: ICurrencyFv,
  frequency: TFrequency
): IStripeExpress => {
  return {
    frequency,
    is_partial: true,
    total_usd: c.min / c.rate,
    base: c.min,
    tip: 0,
    fee_allowance: 0,
    total_atomic: to_atomic_c(c.code)(c.min),
    total: c.min,
    items: [],
    currency: c.code.toLowerCase(),
  };
};

export const stripe_express_priced = (
  c: ICurrencyFv,
  frequency: TFrequency,
  fv: IAmountsInput
): IStripeExpress => {
  const to_atomic = to_atomic_c(c.code);
  const { base, tip, fee_allowance } = stripe_amounts({ ...fv, currency: c });

  const items: ILineItem[] = [
    { name: "Donation", amount_atomic: to_atomic(base) },
  ];
  if (tip) {
    items.push({
      name: "Donation to Better Giving",
      amount_atomic: to_atomic(tip),
    });
  }
  if (fee_allowance) {
    items.push({
      name: "Fee coverage",
      amount_atomic: to_atomic(fee_allowance),
    });
  }

  const total = base + tip + fee_allowance;
  /** total_atomic should match line items */
  const total_atomic = items
    .map((x) => x.amount_atomic)
    .reduce((a, b) => a + b, 0);

  return {
    frequency,
    base,
    tip,
    fee_allowance,
    is_partial: false,
    total_usd: total / c.rate,
    total_atomic,
    total,
    items,
    currency: c.code.toLowerCase(),
  };
};

const paypal_express_partial = (
  currency: string,
  frequency: TFrequency
): IPayPalExpress => {
  return {
    currency,
    frequency,
    amnt: 1,
    tip: 0,
    fee_allowance: 0,
    is_partial: true,
  };
};

export function use_rhf(fv: FV) {
  const {
    control,
    handleSubmit,
    register,
    setValue,
    getValues,
    trigger,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FV>({
    defaultValues: fv,
    resolver: valibotResolver(stripe_donation_details),
    criteriaMode: "all",
  });

  const { field: frequency } = useController<FV, "frequency">({
    control,
    name: "frequency",
  });

  const { field: amount } = useController<FV, "amount">({
    control,
    name: "amount",
  });

  const { field: currency } = useController<FV, "currency">({
    control,
    name: "currency",
  });

  const { field: tip_format } = useController<FV, "tip_format">({
    control,
    name: "tip_format",
  });
  const { field: cpf } = useController<FV, "cover_processing_fee">({
    control,
    name: "cover_processing_fee",
  });

  const on_increment: OnIncrement = (inc) => {
    const amnt = Number(getValues("amount"));
    if (Number.isNaN(amnt)) return trigger("amount", { shouldFocus: true });
    setValue("amount", rd(amnt + inc, 0), { shouldValidate: true });
  };

  const tip = watch("tip");
  const amnt = watch("amount");

  const stripe_express = ((...x): IStripeExpress | null => {
    const [a, c, pf, tf, f] = x;

    if (!c.code) return null;

    const ap = safeParse(amount_schema({ required: true }), a);
    if (ap.issues) return stripe_express_partial(c, f);

    const amnt = +ap.output;
    if (amnt < c.min) return stripe_express_partial(c, f);

    return stripe_express_priced(c, f, {
      amount: amnt,
      tip_format: tf,
      tip,
      cover_processing_fee: pf,
    });
  })(amnt, currency.value, cpf.value, tip_format.value, frequency.value);

  const paypal_express = ((...x): IPayPalExpress | null => {
    const [a, c, pf, tf, f] = x;

    if (!c.code) return null;
    const d = paypal_currencies[c.code];
    if (d === undefined) return null;

    const ap = safeParse(amount_schema({ required: true }), a);
    if (ap.issues) return paypal_express_partial(c.code, f);

    const amnt = +ap.output;
    if (amnt < c.min) return paypal_express_partial(c.code, f);

    const items: IITem[] = [
      {
        name: "Donation",
        amnt: rd(amnt, d),
      },
    ];

    const tipv = tip_val(tf, tip, amnt);
    if (tipv) {
      items.push({
        name: "Donation to Better Giving",
        amnt: rd(tipv, d),
      });
    }

    const mfa = pf
      ? min_fee_allowance(
          tipv + amnt,
          fee_terms.paypal.rate,
          fee_terms.paypal.flat * c.rate
        )
      : 0;

    if (mfa) {
      items.push({
        name: "Fee coverage",
        amnt: rd(mfa, d),
      });
    }

    return {
      currency: c.code,
      frequency: f,
      is_partial: false,
      amnt,
      tip: tipv,
      fee_allowance: mfa,
    };
  })(amnt, currency.value, cpf.value, tip_format.value, frequency.value);

  return {
    frequency,
    currency,
    amount,
    on_increment,
    stripe_express,
    paypal_express,
    register,
    handleSubmit,
    isSubmitting,
    setValue,
    errors,
    tip_format,
    setFocus,
    getValues,
    cpf,
    tip,
    trigger,
  };
}
