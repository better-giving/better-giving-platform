import { Badge, Button } from "@better-giving/ui";
import { Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import { to_utc_day } from "@/helpers/date";
import { humanize } from "@/helpers/decimal";
import type { HeldRail, IHeldMoney } from "@/payouts";

const rail_labels: Record<HeldRail, string> = {
  stripe: "Card, bank and wallet donations",
  paypal: "PayPal donations",
  daf: "DAF grants",
  crypto: "Crypto donations",
  stock_cheque: "Stock and cheque donations",
  withdrawal: "Savings and Investments withdrawals",
};

/** one pending payout, as the Payouts list names it */
const item_labels: Record<HeldRail, string> = {
  stripe: "Card, bank or wallet donation",
  paypal: "PayPal donation",
  daf: "DAF grant",
  crypto: "Crypto donation",
  stock_cheque: "Stock or cheque donation",
  withdrawal: "Savings or Investments withdrawal",
};

/** `stripe`: a Stripe account is linked (ready or not yet) and no bank is
 *  on file. `none`: neither, Stripe disconnected and no bank */
export type THeldRails = "stripe" | "none";

export interface IHeldMoneyCard {
  held: IHeldMoney;
  rails: THeldRails;
  /** a bank account is filed and under review: the money waits for its
   *  approval, so the card asks for no bank */
  bank_pending?: boolean;
  /** the add-bank page, through the router */
  add_bank_href: string;
  /** the Stripe connect start route, navigated to in full. `none` only */
  connect_href?: string;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

interface IUsd {
  amount: number;
  classes?: string;
}

/** a dollar figure, written as the Payouts tables write theirs */
function Usd({ amount, classes = "" }: IUsd) {
  return (
    <span className={`${classes} figures`}>
      {amount < 0 ? "-" : ""}${humanize(Math.abs(amount))}
    </span>
  );
}

/** what the payout takes off `total` for amounts owed (positive), or adds for
 *  amounts due back (negative). null while nothing is netted */
const net_adjustment = ({ total, net }: IHeldMoney): number | null =>
  net === undefined || net === total
    ? null
    : Math.round((total - net) * 100) / 100;

/** what is owed takes all of it: nothing pays out. `held_money_net` gives 0 */
const is_covered = ({ net }: IHeldMoney) => net !== undefined && net <= 0;

const until = (bank_pending: boolean) =>
  bank_pending
    ? "until your bank account is approved"
    : "until you add a bank account";

/** the total is net of what is owed when the query could say so; otherwise
 *  the payout still nets refunds and disputes owed, and waits for the minimum.
 *  never while `is_covered`: nothing pays out */
const release_line = (bank_pending: boolean, netted: boolean) =>
  `Once ${bank_pending ? "your bank account is approved" : "you add a bank account"}, this money pays out with your bank payout${netted ? "" : ", less any refunds or disputes owed,"} once your balance reaches your payout minimum.`;

/** the lead while card, bank and wallet donations are among what waits: true
 *  at every linked status, ready included, since a gift held before ready
 *  stays held */
const stripe_held_lead = (bank_pending: boolean) =>
  `Card, bank and wallet donations that arrive before your Stripe account is ready wait here, along with the donations Stripe can't receive. They stay in your Better Giving balance ${until(bank_pending)}. Nothing is lost.`;

interface ICopy {
  heading: string;
  lead: string;
}

/** the payout promise drops while `is_covered`, as `release_line` does */
const none_copy = (
  held: IHeldMoney,
  bank_pending: boolean,
  pending_heading: string
): ICopy => {
  const promise = !is_covered(held);
  return bank_pending
    ? {
        heading: pending_heading,
        lead: `Stripe is disconnected and your bank account is still under review, so every donation is held in your Better Giving balance. Nothing is lost.${promise ? " It pays out once your bank account is approved, or connect Stripe again to get paid there." : ""}`,
      }
    : {
        heading: "No way to get paid right now",
        lead: `Stripe is disconnected and you have no bank account, so every donation is held in your Better Giving balance. Nothing is lost.${promise ? " Add a bank account or connect Stripe again to get paid." : ""}`,
      };
};

const BANKING_PENDING_HEADING = "Waiting for your bank account to be approved";

/** Banking: what waits for a bank, by kind of money. renders nothing while
 *  nothing waits */
export function HeldMoneyCard(props: IHeldMoneyCard) {
  const { held, rails, bank_pending = false } = props;
  if (held.total <= 0) return null;
  const copy =
    rails === "none"
      ? none_copy(held, bank_pending, BANKING_PENDING_HEADING)
      : {
          heading: bank_pending
            ? BANKING_PENDING_HEADING
            : "Waiting for a bank account",
          lead: held.by_rail.some((r) => r.rail === "stripe")
            ? stripe_held_lead(bank_pending)
            : `Stripe can only receive card, bank and wallet donations. The rest can't go to Stripe, so they stay in your Better Giving balance ${until(bank_pending)}. Nothing is lost.`,
        };
  return (
    <HeldShell {...props} {...copy}>
      <table className="table plain-zero-table">
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
              <td className="text-right">
                <Usd amount={r.amount} />
              </td>
            </tr>
          ))}
        </tbody>
        <NetRows held={held} label_span={1} />
      </table>
    </HeldShell>
  );
}

const PAYOUTS_PENDING_HEADING = "On hold until your bank account is approved";

/** Payouts: each pending payout waiting for a bank, newest first. renders
 *  nothing while nothing waits */
export function PayoutsHeldCard(props: IHeldMoneyCard) {
  const { held, rails, bank_pending = false } = props;
  if (held.total <= 0) return null;
  const newest_first = [...held.items].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
  const copy =
    rails === "none"
      ? none_copy(held, bank_pending, PAYOUTS_PENDING_HEADING)
      : {
          heading: bank_pending
            ? PAYOUTS_PENDING_HEADING
            : "On hold until you add a bank account",
          lead: held.items.some((it) => it.rail === "stripe")
            ? stripe_held_lead(bank_pending)
            : `Stripe can only receive card, bank and wallet donations, so everything else waits in your Better Giving balance${bank_pending ? ` ${until(true)}` : ""}. Nothing is lost.`,
        };
  return (
    <HeldShell {...props} {...copy}>
      <table className="table plain-zero-table">
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
              <td>{item_labels[it.rail]}</td>
              <td>{to_utc_day(it.date)}</td>
              <td className="text-right">
                <Usd amount={it.amount} />
              </td>
            </tr>
          ))}
        </tbody>
        <NetRows held={held} label_span={2} />
      </table>
    </HeldShell>
  );
}

interface INetRows {
  held: IHeldMoney;
  /** the columns before Amount */
  label_span: number;
}

/** the netting under the gross rows, so the table sums to the headline.
 *  nothing while nothing is netted */
function NetRows({ held, label_span }: INetRows) {
  const adjustment = net_adjustment(held);
  if (adjustment === null) return null;
  return (
    <tfoot>
      <tr>
        <td colSpan={label_span}>
          {adjustment > 0
            ? "Owed to Better Giving"
            : "Due back to you from Better Giving"}
        </td>
        <td className="text-right">
          <Usd amount={-adjustment} />
        </td>
      </tr>
      <tr className="font-medium">
        <td colSpan={label_span}>Total</td>
        <td className="text-right">
          <Usd amount={held.net ?? held.total} />
        </td>
      </tr>
    </tfoot>
  );
}

const COVERED_LINE =
  "What you owe Better Giving covers all of it, so none of it will pay out to you.";

const net_caption = (held: IHeldMoney, adjustment: number) =>
  is_covered(held)
    ? COVERED_LINE
    : adjustment > 0
      ? "After amounts you owe Better Giving"
      : "With amounts Better Giving owes you";

interface IHeldShell extends IHeldMoneyCard, ICopy {
  /** the breakdown table */
  children: ReactNode;
}

function HeldShell({
  held,
  rails,
  bank_pending = false,
  add_bank_href,
  connect_href,
  heading,
  lead,
  classes = "",
  children,
}: IHeldShell) {
  const heading_id = useId();
  const offers_connect = rails === "none" && !!connect_href;
  const adjustment = net_adjustment(held);
  const netted = adjustment !== null;
  const covered = is_covered(held);
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
        <Usd
          amount={held.net ?? held.total}
          classes="font-display text-3xl font-bold"
        />
        {netted && (
          <span className="text-gray-11">{net_caption(held, adjustment)}</span>
        )}
      </p>
      <div className="table-scroll">{children}</div>
      {rails === "stripe" && !covered && (
        <p className="text-gray-11">{release_line(bank_pending, netted)}</p>
      )}
      {(!bank_pending || offers_connect) && (
        <div className="flex flex-wrap gap-4">
          {!bank_pending && (
            <Button variant="primary" to={add_bank_href}>
              <Plus aria-hidden className="mr-2 icon-md" />
              <span>Add bank account</span>
            </Button>
          )}
          {offers_connect && (
            <a href={connect_href} className="btn btn-secondary">
              Connect Stripe
            </a>
          )}
        </div>
      )}
    </section>
  );
}
