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
    <section aria-labelledby={heading_id} className={classes}>
      <h2 id={heading_id} className="font-bold text-lg">
        Sent to your Stripe account
      </h2>
      <p className="text-sm text-gray-11 mt-1 mb-3 max-w-3xl">
        {sent.truncated && "Showing the most recent. "}
        Your{" "}
        <ExtLink
          href="https://dashboard.stripe.com/"
          className="inline-flex items-center gap-1 link"
        >
          <span>Stripe dashboard</span>
          <SquareArrowOutUpRight aria-hidden className="icon-sm" />
        </ExtLink>{" "}
        has the full detail.
      </p>
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
