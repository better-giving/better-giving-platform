import { Button, EmptyState } from "@better-giving/ui";
import { Landmark, Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { BANK_PAYOUT_LINE } from "./rows";

export interface IBankPayoutSection {
  /** the bank accounts table; absent while none is on file */
  table?: ReactNode;
  /** the nonprofit's Stripe account */
  stripe_status: TConnectStatus;
  /** the held-money card shows above, carrying its own Add bank account, so
   *  the page keeps one primary button */
  holds_money: boolean;
  /** the add-bank page, through the router */
  add_href: string;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

/** Banking's bank payout section: what it does, the accounts, the way to add
 *  one */
export function BankPayoutSection({
  table,
  stripe_status,
  holds_money,
  add_href,
  classes = "",
}: IBankPayoutSection) {
  const heading_id = useId();
  // only a ready account takes Stripe donations off the bank; before ready
  // (incomplete, pending) they wait for a bank like everything else
  const stripe_ready = stripe_status === "ready";
  return (
    <section aria-labelledby={heading_id} className={`${classes} grid gap-3`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid gap-1">
          <h2 id={heading_id} className="text-lg font-semibold">
            Bank payout
          </h2>
          <p className="text-sm text-gray-11 max-w-3xl">
            {BANK_PAYOUT_LINE}
            {table && stripe_ready && (
              <> Everything except Stripe donations pays out here.</>
            )}
          </p>
        </div>
        {!holds_money && (
          <Button variant="primary" to={add_href} classes="md:shrink-0">
            <Plus aria-hidden className="mr-2 icon-md" />
            <span className="whitespace-nowrap">Add bank account</span>
          </Button>
        )}
      </div>

      {table ?? (
        <div className="card">
          <EmptyState
            heading="No bank account yet"
            icon={<Landmark className="icon-xl" />}
          >
            {empty_line(stripe_ready, holds_money)}
          </EmptyState>
        </div>
      )}
    </section>
  );
}

const empty_line = (stripe_ready: boolean, holds_money: boolean) => {
  if (stripe_ready)
    return holds_money
      ? "Add one to release held money and have everything else pay out to your bank."
      : "Add one to have everything else pay out to your bank.";
  return holds_money
    ? "Add one to release held money and get everything paid out to your bank."
    : "Add one to get everything paid out to your bank.";
};
