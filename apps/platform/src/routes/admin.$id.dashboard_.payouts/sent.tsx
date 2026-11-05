import { EmptyRow, ExtLink } from "@better-giving/ui";
import { format } from "date-fns";
import { SquareArrowOutUpRight } from "lucide-react";
import { useId } from "react";
import { humanize } from "@/helpers/decimal";
import type { INpoSent, TSentStanding } from "@/stripe-connect/sent";

/** where a card gift made now goes: the connected account (`on`), or the bank
 * while the account stays linked (`off`) or after a disconnect */
export type TStripeLink = "on" | "off" | "disconnected";

export const stripe_link = (sent: INpoSent): TStripeLink =>
  sent.on_stripe ? "on" : sent.connected ? "off" : "disconnected";

interface ICopy {
  heading: string;
  lead: string;
}

const list_copy: Record<TStripeLink, ICopy> = {
  on: {
    heading: "Sent to your Stripe account",
    lead: "Each donation paid through Stripe is sent here as its own transfer, after fees.",
  },
  off: {
    heading: "Sent to Stripe earlier",
    lead: "Stripe donations sent to your Stripe account before. New Stripe donations pay out to your bank.",
  },
  disconnected: {
    heading: "Sent to Stripe earlier",
    lead: "Your Stripe account is disconnected, so new Stripe donations pay out to your bank. These were sent to it while it was connected.",
  },
};

export interface ISentToStripe {
  sent: INpoSent;
  /** outer placement only — margin */
  classes?: string;
}

const usd = (n: number) => `$${humanize(n)}`;

interface ITone {
  label: string;
  ink: string;
  dot: string;
}

const tones: Record<TSentStanding["kind"], ITone> = {
  paid: {
    label: "Paid out",
    ink: "text-success-subtle-fg",
    dot: "bg-success",
  },
  partial: {
    label: "Partly reversed",
    ink: "text-warning-subtle-fg",
    dot: "bg-warning",
  },
  reversed: {
    label: "Fully reversed",
    ink: "text-destructive-subtle-fg",
    dot: "bg-destructive",
  },
  unknown: {
    label: "Status unavailable",
    ink: "text-gray-11",
    dot: "bg-gray-9",
  },
};

interface IStanding {
  standing: TSentStanding;
}

function Standing({ standing }: IStanding) {
  const tone = tones[standing.kind];
  const label =
    standing.kind === "partial"
      ? `${tone.label} (${usd(standing.reversed)})`
      : tone.label;
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-medium ${tone.ink}`}
    >
      <span aria-hidden className={`w-2 h-2 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}

/** routed transfers paid to the nonprofit's connected account. balances, fees
 * and what reached the bank stay on stripe */
export function SentToStripe({ sent, classes = "" }: ISentToStripe) {
  const heading_id = useId();
  const copy = list_copy[stripe_link(sent)];
  return (
    <section aria-labelledby={heading_id} className={`${classes} grid gap-3`}>
      <div className="grid gap-1">
        <h2 id={heading_id} className="font-bold text-lg">
          {copy.heading}
        </h2>
        <p className="text-sm text-gray-11 max-w-3xl">
          {sent.truncated && "Showing the most recent. "}
          {copy.lead} What Stripe has paid on to your bank is in your{" "}
          <ExtLink
            href="https://dashboard.stripe.com/"
            className="inline-flex items-center gap-1 link"
          >
            <span>Stripe dashboard</span>
            <SquareArrowOutUpRight aria-hidden className="icon-sm" />
          </ExtLink>
          .
        </p>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sent.items.length === 0 ? (
              <EmptyRow col_span={3}>No transfers yet</EmptyRow>
            ) : (
              sent.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span
                      className={
                        t.standing.kind === "reversed"
                          ? "line-through text-destructive-subtle-fg"
                          : ""
                      }
                    >
                      {usd(t.amount)}
                    </span>
                  </td>
                  <td>{format(t.date, "PP")}</td>
                  <td>
                    <Standing standing={t.standing} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface IWell {
  title: string;
  detail: string;
}

/** the stripe list's well, then the bank list's */
const wells: Record<TStripeLink, [IWell, IWell]> = {
  on: [
    {
      title: list_copy.on.heading,
      detail:
        "Donations paid through Stripe (cards, digital wallets and bank debits), each sent as its own transfer, after fees.",
    },
    {
      title: "Payouts",
      detail:
        "PayPal, DAF grants, crypto, stocks, cheques, and any Stripe donations from before you connected Stripe: the Grant share of each, sent to your bank through Wise.",
    },
  ],
  off: [
    {
      title: list_copy.off.heading,
      detail:
        "Stripe donations sent to your Stripe account before. New ones are not sent there.",
    },
    {
      title: "Payouts",
      detail:
        "Everything sent to your bank through Wise, new Stripe donations included.",
    },
  ],
  disconnected: [
    {
      title: list_copy.disconnected.heading,
      detail:
        "Stripe donations sent to your Stripe account while it was connected.",
    },
    {
      title: "Payouts",
      detail:
        "Everything sent to your bank through Wise. Your Stripe account is disconnected, so new Stripe donations are here too.",
    },
  ],
};

export interface IWhereMoneyShows {
  link: TStripeLink;
}

/** which of the page's two lists a donation lands in. mount it only beside
 * both */
export function WhereMoneyShows({ link }: IWhereMoneyShows) {
  const heading_id = useId();
  return (
    <section aria-labelledby={heading_id} className="card grid gap-3 text-sm">
      <h2 id={heading_id} className="text-lg font-semibold">
        Where your money shows
      </h2>
      {/* columns follow the box, as in `PayoutOptions` */}
      <div className="@container">
        <div className="grid gap-4 @3xl:grid-cols-2">
          {wells[link].map((w) => (
            <div
              key={w.title}
              className="bg-panel rounded p-4 grid gap-1 content-start"
            >
              <h3 className="font-semibold">{w.title}</h3>
              <p className="text-gray-11">{w.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
