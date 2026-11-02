import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import type { IPaginator } from "#/types/components";
import { humanize } from "@/helpers/decimal";
import type { IInterestLog } from "@/liquid";

export interface Props extends IPaginator<IInterestLog> {}

export function InterestHistoryTable({
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
            <th>Date</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={2}>No interest logs yet</EmptyRow>
          ) : (
            items.map((r, idx) => (
              <tr key={idx} className="text-sm">
                <td>{format(r.date_created, "PP")}</td>
                <td>${humanize(r.total)}</td>
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
