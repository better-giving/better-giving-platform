import { EmptyRow, ExtLink } from "@better-giving/ui";
import { format } from "date-fns";
import { SquareArrowOutUpRight } from "lucide-react";
import { useId } from "react";
import { humanize } from "@/helpers/decimal";
import type { ISentTransfers, TSentStanding } from "@/stripe-connect/sent";

export interface ISentToStripe {
  sent: ISentTransfers;
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
  return (
    <section aria-labelledby={heading_id} className={`${classes} grid gap-3`}>
      <div className="grid gap-1">
        <h2 id={heading_id} className="font-bold text-lg">
          Sent to your Stripe account
        </h2>
        <p className="text-sm text-gray-11 max-w-3xl">
          {sent.truncated && "Showing the most recent. "}
          Each donation paid through Stripe is sent here as its own transfer,
          after fees. What Stripe has paid on to your bank is in your{" "}
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

const wells: IWell[] = [
  {
    title: "Sent to your Stripe account",
    detail:
      "Donations paid through Stripe (cards, digital wallets and bank debits), each sent as its own transfer, after fees.",
  },
  {
    title: "Payouts",
    detail:
      "Everything else: stocks, DAF grants, crypto, PayPal, cheques and savings, sent to your bank through Wise. Stripe donations from before you connected Stripe are here too.",
  },
];

/** which of the page's two lists a donation lands in */
export function WhereMoneyShows() {
  const heading_id = useId();
  return (
    <section aria-labelledby={heading_id} className="card grid gap-3 text-sm">
      <h2 id={heading_id} className="text-lg font-semibold">
        Where your money shows
      </h2>
      {/* columns follow the box, as in `PayoutOptions` */}
      <div className="@container">
        <div className="grid gap-4 @3xl:grid-cols-2">
          {wells.map((w) => (
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
