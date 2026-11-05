import { to_usd } from "@better-giving/ui/helpers";
import { format, formatDistance } from "date-fns";
import { PencilIcon } from "lucide-react";
import { Link } from "react-router";
import type { TPayoutTo } from "./payout-to";

interface Props {
  bal_cash: number;
  threshold: number;
  next_payout: string;
  to: TPayoutTo;
  classes?: string;
}

export function Payout({ classes = "", ...p }: Props) {
  // with no bank nothing pays out at the minimum, so there is no bar to fill
  if (p.to.kind !== "bank") {
    return (
      <div className={classes}>
        <Held to={p.to} />
      </div>
    );
  }
  const progress = Math.min(p.bal_cash / p.threshold, 1);
  return (
    <div className={`${classes}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="space-x-1 mb-1">
          <span className="text-xs">Total</span>
          <span className="font-bold">{to_usd(p.bal_cash, 2)}</span>
        </div>
        <div className="space-x-1">
          <span className="text-xs">of</span>
          <span className="text-sm">{to_usd(p.threshold, 2)}</span>
          <Link
            to={{ pathname: "payout-min", search: `?min=${p.threshold}` }}
            replace
            preventScrollReset
            aria-label="Edit payout threshold"
            className="text-xs inline-block"
          >
            <PencilIcon className="icon-xs" />
          </Link>
        </div>
      </div>
      <div
        style={{
          backgroundImage: `linear-gradient(to right, var(--success) 0%, var(--success) ${Math.min(progress * 100, 100)}%, var(--gray-4) ${Math.min(progress * 100, 100)}%, var(--gray-4) 100%)`,
        }}
        className="py-1 rounded-full inset-shadow-track mb-2"
      />
      <p className="text-sm">
        {progress < 1 ? "Once desired amount is accumulated, " : ""}
        will be paid out to{" "}
        {
          <Link to="../banking" className="link font-medium">
            {p.to.summary}
          </Link>
        }{" "}
        on{" "}
        {
          <span className="">
            {format(p.next_payout, "PP")}
            <span className="text-gray-11">
              - in {formatDistance(p.next_payout, new Date())}
            </span>
            .
          </span>
        }
      </p>
    </div>
  );
}

interface IHeld {
  to: Exclude<TPayoutTo, { kind: "bank" }>;
}

function Held({ to }: IHeld) {
  const add_bank = (
    <Link to="../banking" className="link font-medium">
      add a bank account
    </Link>
  );
  if (to.kind === "none") {
    return (
      <p className="text-sm">
        You have no way to get paid right now. Donations wait in your Better
        Giving balance until you {add_bank}. Nothing is lost.
      </p>
    );
  }
  // a stripe gift that lands before ready stays held after ready too, per the
  // held cards' STRIPE_HELD_LEAD (components/payout-options/held-money.tsx)
  if (!to.ready) {
    return (
      <p className="text-sm">
        Stripe donations that arrive before your Stripe account is ready wait in
        your Better Giving balance, along with everything else, until you{" "}
        {add_bank}. Nothing is lost.
      </p>
    );
  }
  return (
    <p className="text-sm">
      Stripe donations go straight to your Stripe account. Everything else waits
      in your Better Giving balance until you {add_bank}.
    </p>
  );
}
