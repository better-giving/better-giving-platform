import { EmptyRow, HeaderButton, LoadMoreRow } from "@better-giving/ui";
import { Folder } from "lucide-react";
import { href, NavLink } from "react-router";
import { use_sort } from "#/hooks/use-sort";
import type { IPaginator } from "#/types/components";
import type { IBapp, TStatus } from "@/banking";
import { toPP } from "@/helpers/date";

export interface IBappRow extends IBapp {
  /** absent when the npo row is gone */
  npo_name?: string;
}

interface Props extends IPaginator<IBappRow> {
  empty_msg?: string;
}

export function Table({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
  empty_msg = "No banking applications found",
}: Props) {
  const { handleHeaderClick, sorted, sortDirection, sortKey } = use_sort(
    items,
    "updated_at"
  );

  return (
    <div className={`${classes} table-scroll`}>
      <table className="table">
        <thead>
          <tr className="whitespace-nowrap">
            <th>
              <HeaderButton
                onClick={handleHeaderClick("updated_at")}
                _activeSortKey={sortKey}
                _sortKey="updated_at"
                _sortDirection={sortDirection}
              >
                Last updated
              </HeaderButton>
            </th>
            <th>Endowment</th>
            <th>Account</th>
            <th>
              <HeaderButton
                onClick={handleHeaderClick("status")}
                _activeSortKey={sortKey}
                _sortKey="status"
                _sortDirection={sortDirection}
              >
                Status
              </HeaderButton>
            </th>
            <th>
              <span className="flex justify-center">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <EmptyRow col_span={5}>{empty_msg}</EmptyRow>
          ) : (
            sorted.map((row) => (
              <tr key={row.id} className="text-sm">
                <td className="whitespace-nowrap">{toPP(row.updated_at)}</td>
                <td>
                  {row.npo_name ?? (
                    <span className="font-mono whitespace-nowrap">
                      {row.npo_id}
                    </span>
                  )}
                </td>
                <td>{row.bank_summary}</td>
                <td>
                  <Status status={row.status} />
                </td>
                <td>
                  <NavLink
                    to={href("/platform/banking-applications/:id", {
                      id: row.id,
                    })}
                    className="text-center w-full inline-block [.pending]:text-gray-11 link"
                  >
                    <Folder
                      aria-label="application details"
                      className="inline-block icon-xl"
                    />
                  </NavLink>
                </td>
              </tr>
            ))
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={5}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}

// "default" is approved *and* the npo's primary account — same verdict, so it
// reads as Approved with the primary-ness as a suffix rather than a 4th state.
const dot_color: Record<TStatus, string> = {
  approved: "bg-success",
  "under-review": "bg-warning",
  rejected: "bg-destructive",
  default: "bg-success",
};

const text_color: Record<TStatus, string> = {
  approved: "text-success-subtle-fg",
  "under-review": "text-warning-subtle-fg",
  rejected: "text-destructive-subtle-fg",
  default: "text-success-subtle-fg",
};

const text: Record<TStatus, string> = {
  approved: "Approved",
  "under-review": "Under review",
  rejected: "Rejected",
  default: "Approved",
};

function Status({ status }: { status: TStatus }) {
  return (
    <span
      className={`${text_color[status]} inline-flex items-center gap-1.5 text-xs font-medium`}
    >
      <span
        className={`${dot_color[status]} size-2 rounded-full inline-block shrink-0`}
      />
      {text[status]}
      {status === "default" && (
        <span className="text-gray-11 font-normal">· primary</span>
      )}
    </span>
  );
}
