import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import { ReturnedGrant } from "#/components/returned-payout";
import type { IPaginator } from "#/types/components";
import { humanize } from "@/helpers/decimal";
import type { IGrantRunDeductions } from "$/pg/queries/owed-history";
import type { SettlementRow } from "$/pg/queries/payout";

export interface IGrantLine extends SettlementRow {
  /** set when the grant recovered anything owed */
  run?: IGrantRunDeductions;
}

export interface Props extends IPaginator<IGrantLine> {}

const usd = (n: number) => `$${humanize(n)}`;

export function GrantsTable({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
}: Props) {
  return (
    <div className={`${classes} table-scroll`}>
      <table className="table">
        <thead>
          <tr>
            <th>Amount</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={2}>No grants yet</EmptyRow>
          ) : (
            items.map((payout, idx) => (
              <tr key={idx}>
                <td>
                  {payout.status === "returned" ? (
                    <ReturnedGrant amount={usd(payout.amount)} />
                  ) : (
                    `${usd(payout.amount)} `
                  )}
                  {payout.run && payout.run.deductions.length > 0 && (
                    <ul className="text-sm text-gray-11">
                      <li>Gross {usd(payout.run.gross)}</li>
                      {payout.run.deductions.map((d) => (
                        <li key={d.owed_id}>
                          {d.usd < 0
                            ? "Paid back for gift "
                            : "Deducted for gift "}
                          <a href={`#owed-${d.owed_id}`} className="link">
                            {d.donation_id}
                          </a>{" "}
                          {d.usd < 0 ? `+${usd(-d.usd)}` : `-${usd(d.usd)}`}
                        </li>
                      ))}
                      <li>Net {usd(payout.run.net)}</li>
                    </ul>
                  )}
                </td>
                <td>{format(payout.date, "PP")}</td>
              </tr>
            ))
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={2}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}
