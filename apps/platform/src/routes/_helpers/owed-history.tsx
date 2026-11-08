import { EmptyRow } from "@better-giving/ui";
import { to_utc_day } from "@/helpers/date";
import { humanize } from "@/helpers/decimal";
import type { IOwedHistoryRow, IOwedRunLine } from "$/pg/queries/owed-history";

export interface IOwedHistory {
  rows: IOwedHistoryRow[];
  /** what recovers a row for this party: its grants, or its commission payouts */
  run_noun: "grant" | "payout";
  /** what the party got from the gift */
  received_label: string;
}

const usd = (n: number) => `$${humanize(n)}`;

const STATUS: Record<IOwedHistoryRow["state"], string> = {
  recorded: "Owed",
  partly_recovered: "Partly recovered",
  recovered: "Recovered",
  credited_back: "Credited back",
  waived: "Waived",
};

/** the party's owed rows. each gift's row header is `#owed-<id>`, which a
 * run's deductions link to; it takes focus when the link is followed */
export function OwedHistory({ rows, run_noun, received_label }: IOwedHistory) {
  return (
    <section aria-labelledby="owed-history" className="mt-8">
      <h2 id="owed-history" className="font-bold text-lg">
        Amounts owed
      </h2>
      <p className="text-sm text-gray-11 mt-1 mb-3 max-w-3xl">
        When a gift is refunded or disputed after you were paid for it, what you
        received and its fees are owed back and deducted from your next{" "}
        {run_noun}s.
      </p>
      <div className="table-scroll">
        <table className="table whitespace-nowrap" aria-labelledby="owed-history">
          <thead>
            <tr className="whitespace-nowrap">
              <th>Gift</th>
              <th>Reason</th>
              <th>{received_label}</th>
              <th>Card fee</th>
              <th>Dispute fee</th>
              <th>Status</th>
              <th>Still owed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow col_span={7}>No amounts owed yet</EmptyRow>
            ) : (
              rows.map((r) => {
                const events = history(r, run_noun);
                return (
                  <tr key={r.id}>
                    {/* scroll-mt clears the sticky app header (~65px) */}
                    <th
                      scope="row"
                      id={`owed-${r.id}`}
                      tabIndex={-1}
                      className="text-left font-normal scroll-mt-20 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 target:outline-2 target:outline-ring target:-outline-offset-2"
                    >
                      <div>{r.donation_id}</div>
                      <div className="text-xs text-gray-11">
                        {humanize(r.gift_amount)} {r.gift_currency} on{" "}
                        {to_utc_day(r.gift_date)}
                      </div>
                    </th>
                    <td>
                      {r.source === "refund" ? "Refund" : "Dispute"}{" "}
                      {to_utc_day(r.recorded_at)}
                    </td>
                    <td className="whitespace-nowrap">{usd(r.received_usd)}</td>
                    <td className="whitespace-nowrap">
                      {usd(r.fee_processing_usd)}
                    </td>
                    <td className="whitespace-nowrap">
                      {usd(r.fee_dispute_usd)}
                    </td>
                    <td>
                      <div>{STATUS[r.state]}</div>
                      {events.length > 0 && (
                        <ul
                          aria-label="History"
                          className="text-xs text-gray-11"
                        >
                          {events.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>
                      {r.outstanding_usd < 0
                        ? `Due to you ${usd(-r.outstanding_usd)}`
                        : usd(r.outstanding_usd)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** what has settled part of the row so far. each credit and the write-off
 * figure is a total over its entries, and the row keeps only the latest date
 * of each, so no total is given a date of its own; a credit or write-off
 * figure is dated by the check constraints on it */
function history(
  r: IOwedHistoryRow,
  run_noun: IOwedHistory["run_noun"]
): string[] {
  const lines: string[] = [];
  if (r.refund_failed_usd > 0) {
    lines.push(`Refund failed: ${usd(r.refund_failed_usd)} credited back`);
  }
  if (r.dispute_won_usd > 0) {
    lines.push(`Dispute settled: ${usd(r.dispute_won_usd)} credited back`);
  }
  if (r.credited_back_usd > 0) {
    lines.push(`${usd(r.credited_back_usd)} credited back`);
  }
  if (lines.length > 0) {
    lines.push(`Most recent credit on ${to_utc_day(r.credited_back_at!)}`);
  }
  if (r.written_off_usd > 0) {
    lines.push(
      `${usd(r.written_off_usd)} waived in total, most recently on ${to_utc_day(r.written_off_at!)}`
    );
  }
  return [...lines, ...r.recoveries.map((l) => run_line(l, run_noun))];
}

const run_line = (l: IOwedRunLine, run_noun: IOwedHistory["run_noun"]) =>
  l.usd < 0
    ? `${usd(-l.usd)} paid back with ${run_noun} of ${to_utc_day(l.at)}`
    : `${usd(l.usd)} from ${run_noun} of ${to_utc_day(l.at)}`;
