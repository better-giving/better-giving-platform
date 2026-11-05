import { Badge } from "@better-giving/ui";
import type { ReactNode } from "react";
import { useId } from "react";
import {
  type TConnectIneligibility,
  TRANSFER_COUNTRIES_COPY,
} from "@/stripe-connect/eligibility";

export interface IBankRequired {
  /** why Stripe is out. absent when Stripe isn't offered at all (routing
   *  off): the note then says nothing about Stripe */
  ineligible?: TConnectIneligibility;
  /** the bank form, with its own Back and Submit */
  children: ReactNode;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

const reasons = (i: TConnectIneligibility) =>
  i.reason === "fiscal_sponsored"
    ? "Stripe isn't available to fiscally sponsored nonprofits."
    : `Stripe isn't available for nonprofits headquartered in ${i.hq_country}. We can send Stripe donations to nonprofits headquartered in ${TRANSFER_COUNTRIES_COPY}.`;

/** registration step 4 for a nonprofit that can't use Stripe: the bank
 *  payout is its only way to get paid, so it is required */
export function BankRequired({
  ineligible,
  children,
  classes = "",
}: IBankRequired) {
  const heading_id = useId();
  return (
    <div className={`${classes} grid gap-6 content-start`}>
      <section aria-labelledby={heading_id} className="grid gap-3">
        <div className="flex items-center gap-2">
          <h2 id={heading_id} className="text-xl">
            Set up your bank payout
          </h2>
          <Badge tone="primary">Required</Badge>
        </div>
        <div className="grid gap-1 rounded bg-panel px-4 py-3 text-sm">
          {ineligible && <p className="font-medium">{reasons(ineligible)}</p>}
          <p className="text-gray-11">
            Your bank payout is how you get paid, so it's required. Every
            donation, Stripe donations included, pays out to your bank, every 3
            days once your balance reaches your payout minimum.
          </p>
        </div>
      </section>
      {children}
    </div>
  );
}
