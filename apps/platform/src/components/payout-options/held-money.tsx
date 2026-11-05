import { Badge, Button } from "@better-giving/ui";
import { Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import { to_utc_day } from "@/helpers/date";
import { humanize } from "@/helpers/decimal";
import type { HeldRail, IHeldMoney } from "@/payouts";

export const rail_labels: Record<HeldRail, string> = {
  stripe: "Stripe donations",
  paypal: "PayPal donations",
  daf: "DAF grants",
  crypto: "Crypto donations",
  stock_cheque: "Stock and cheque donations",
  withdrawal: "Savings and Investments withdrawals",
};

/** `stripe`: a Stripe account is linked (ready or not yet) and no bank is
 *  on file. `none`: neither, Stripe disconnected and no bank */
export type THeldRails = "stripe" | "none";

export interface IHeldMoneyCard {
  held: IHeldMoney;
  rails: THeldRails;
  /** the add-bank page, through the router */
  add_bank_href: string;
  /** the Stripe connect start route, navigated to in full. `none` only */
  connect_href?: string;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

const usd = (n: number) => `$${humanize(n)}`;

/** the total is gross; the payout nets refunds and disputes owed and waits
 *  for the minimum */
const RELEASE_LINE =
  "Once you add a bank account, this money pays out with your bank payout, less any refunds or disputes owed, once your balance reaches your payout minimum.";

/** the lead while Stripe donations are among what waits: true at every
 *  linked status, ready included, since a gift held before ready stays held */
const STRIPE_HELD_LEAD =
  "Stripe donations that arrive before your Stripe account is ready wait here, along with the donations Stripe can't receive. They stay in your Better Giving balance until you add a bank account. Nothing is lost.";

const NONE_COPY = {
  heading: "No way to get paid right now",
  lead: "Stripe is disconnected and you have no bank account, so every donation is held in your Better Giving balance. Nothing is lost. Add a bank account or connect Stripe again to get paid.",
};

/** Banking: what waits for a bank, by kind of money. renders nothing while
 *  nothing waits */
export function HeldMoneyCard(props: IHeldMoneyCard) {
  const { held, rails } = props;
  if (held.total <= 0) return null;
  const copy =
    rails === "none"
      ? NONE_COPY
      : {
          heading: "Waiting for a bank account",
          lead: held.by_rail.some((r) => r.rail === "stripe")
            ? STRIPE_HELD_LEAD
            : "Stripe can only receive Stripe donations. These can't go to Stripe, so they stay in your Better Giving balance until you add a bank account. Nothing is lost.",
        };
  return (
    <HeldShell {...props} {...copy}>
      <table className="table">
        <thead>
          <tr>
            <th>What's waiting</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {held.by_rail.map((r) => (
            <tr key={r.rail}>
              <td>{rail_labels[r.rail]}</td>
              <td className="text-right">{usd(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HeldShell>
  );
}

/** Payouts: each pending payout waiting for a bank, newest first. renders
 *  nothing while nothing waits */
export function PayoutsHeldCard(props: IHeldMoneyCard) {
  const { held, rails } = props;
  if (held.total <= 0) return null;
  const newest_first = [...held.items].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
  const copy =
    rails === "none"
      ? NONE_COPY
      : {
          heading: "On hold until you add a bank account",
          lead: held.items.some((it) => it.rail === "stripe")
            ? STRIPE_HELD_LEAD
            : "Stripe can only receive Stripe donations, so everything else waits in your Better Giving balance. Nothing is lost.",
        };
  return (
    <HeldShell {...props} {...copy}>
      <table className="table">
        <thead>
          <tr>
            <th>From</th>
            <th>Date</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {newest_first.map((it, i) => (
            // a pending payout carries no id of its own here
            <tr key={i}>
              <td>{rail_labels[it.rail]}</td>
              <td>{to_utc_day(it.date)}</td>
              <td className="text-right">{usd(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HeldShell>
  );
}

interface IHeldShell extends IHeldMoneyCard {
  heading: string;
  lead: string;
  /** the breakdown table */
  children: ReactNode;
}

function HeldShell({
  held,
  rails,
  add_bank_href,
  connect_href,
  heading,
  lead,
  classes = "",
  children,
}: IHeldShell) {
  const heading_id = useId();
  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card border-warning grid gap-4 text-sm`}
    >
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={heading_id} className="text-lg font-semibold">
            {heading}
          </h2>
          <Badge tone="warning">Held</Badge>
        </div>
        <p className="text-gray-11 max-w-3xl">{lead}</p>
      </div>
      <p className="grid gap-1">
        <span className="text-gray-11">Held right now</span>
        <span className="font-display text-3xl font-bold">
          {usd(held.total)}
        </span>
      </p>
      <div className="table-scroll">{children}</div>
      {rails === "stripe" && <p className="text-gray-11">{RELEASE_LINE}</p>}
      <div className="flex flex-wrap gap-4">
        <Button variant="primary" to={add_bank_href}>
          <Plus aria-hidden className="mr-2 icon-md" />
          <span>Add bank account</span>
        </Button>
        {rails === "none" && connect_href && (
          <a href={connect_href} className="btn btn-secondary">
            Connect Stripe
          </a>
        )}
      </div>
    </section>
  );
}
