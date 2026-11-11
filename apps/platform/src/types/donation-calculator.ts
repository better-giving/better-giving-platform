import * as v from "valibot";
import { amount_num } from "@/schemas/amount";

export const methods: { [id: string]: string } = {
  "credit-card": "Credit Card",
  ach: "ACH (Bank Transfer)",
  "digital-wallets": "Digital Wallets",
  crypto: "Crypto",
  stocks: "Stocks",
  daf: "DAF",
};

export const methodsArr = Object.keys(methods);

const str = v.pipe(v.string(), v.nonEmpty());
/** dollars: typed through a mask, then written into the url as a plain number */
const num = v.pipe(str, amount_num(Number.POSITIVE_INFINITY), v.minValue(0));
/** a slider's share, 0 to 1, written into the url with `toString()` — not
 * typed text, and a float can print in exponent form, which `amount_num`
 * would refuse */
const rate = v.pipe(
  str,
  v.transform((x) => +x),
  v.minValue(0),
  v.maxValue(1)
);
/** annual figures */
export const ogInput = v.object({
  amnt: num,
  processingFeeRate: rate,
  processingFeeCovered: v.pipe(str, v.parseBoolean()),
  platformFeeRate: rate,
  subsCost: num,
  donMethods: v.pipe(
    str,
    v.transform((x) => x.split(",")),
    v.array(v.picklist(methodsArr))
  ),
  notGrantedRate: rate,
  investRate: rate,
});

export interface OgInput extends v.InferOutput<typeof ogInput> {}
export const ogInputDefault: OgInput = {
  amnt: 100_000,
  processingFeeRate: 0.029,
  processingFeeCovered: false,
  platformFeeRate: 0.02,
  subsCost: 1200,
  donMethods: ["credit-card"],
  notGrantedRate: 0.1,
  investRate: 0.5,
};

export interface OgInputParams extends v.InferInput<typeof ogInput> {}
