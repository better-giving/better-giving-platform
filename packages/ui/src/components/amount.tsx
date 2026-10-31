import type { ReactNode } from "react";

interface IAmount {
  /** the primary figure, already formatted by the caller. rendered tabular, so
   * the caller owns precision — this component never rounds. */
  value: string;
  /** iso code; uppercased here and shown as the leading chip. */
  currency: string;
  /** formatted usd magnitude WITHOUT the symbol — the "$" is drawn here.
   * suppressed when `currency` is already USD, so a usd-denominated amount can
   * pass it unconditionally. */
  usd?: string | null;
  chips?: ReactNode[];
  classes?: string;
}

export function Amount({ value, currency, usd, chips, classes = "" }: IAmount) {
  const c = currency.toUpperCase();
  return (
    <span className={`inline-flex items-baseline gap-x-1.5 ${classes}`}>
      <span className="text-xs font-medium text-gray-11">{c}</span>
      <span className="figures">{value}</span>
      {usd != null && c !== "USD" && (
        <span className="text-xs text-gray-11 figures">${usd}</span>
      )}
      {chips}
    </span>
  );
}
