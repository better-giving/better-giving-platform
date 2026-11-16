import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import { GrantAmount } from "#/components/returned-payout";
import type { IPaginator } from "#/types/components";
import { humanize } from "@/helpers/decimal";
import type { GrantRow } from "$/pg/queries/payout";

export interface Props extends IPaginator<GrantRow> {}

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
          {items.length === 0 && (
            <EmptyRow col_span={2}>No grants yet</EmptyRow>
          )}
          {items.map((payout, idx) => (
            <tr key={idx}>
              <td>
                <GrantAmount
                  grant={payout}
                  amount={`$${humanize(payout.amount)}`}
                />
              </td>
              <td>{format(payout.date, "PP")}</td>
            </tr>
          ))}
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
