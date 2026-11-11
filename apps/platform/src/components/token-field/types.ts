import type { ReactNode } from "react";

type Classes = {
  container?: string;
  label?: string;
  input?: string;
};

export interface ITokenField {
  label: string;
  /** the plain decimal the form stores; the field shows it grouped */
  amount: string;
  /** decimals the amount may have: the currency's or token's precision. no cap when unset */
  places?: number;
  amount_usd: number;
  on_change: (v: string) => void;
  combobox?: ReactNode;
  error?: string;
  disabled?: boolean;
  classes?: Classes | string;
}

export type TTokenState = "loading" | "error" | undefined;
