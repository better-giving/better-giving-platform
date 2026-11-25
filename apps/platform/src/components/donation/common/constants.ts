import type { ICurrencyFv } from "#/types/components";
import type { DonateMethodId, TFrequency } from "@/schemas";
import type { ITickerFv, ITokenFv } from "../types";

export const init_token_option: ITokenFv = {
  precision: 6,
  min: 0,
  code: "",
  name: "",
  symbol: "",
  id: "",
  amount: "",
  network: "",
  cg_id: "",
  color: "",
  logo: "",
  // no price known — the amount field shows no usd preview
  usdpu: 0,
};

export const init_ticker_option: ITickerFv = {
  symbol: "",
  amount: "",
  name: "",
  min: 0,
  usdpu: 0,
};

const USD_CODE = "USD";
export const usd_option: ICurrencyFv = { code: USD_CODE, min: 2, rate: 1 };

export const all_method_ids: DonateMethodId[] = [
  "stripe",
  "stripe_bank",
  "daf",
  "stocks",
  "ira_qcd",
  "crypto",
];

export const freqs_default: TFrequency[] = ["one-time", "monthly"];

export const freqs_shown = (
  freqs: TFrequency[] | undefined
): TFrequency[] | null => {
  if (!freqs || freqs.length === 0) return freqs_default;
  // hide frequency selector if only one option and it's one-time
  if (freqs.length === 1 && freqs[0] === "one-time") return null;
  return freqs;
};
