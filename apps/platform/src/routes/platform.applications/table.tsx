import { EmptyRow, HeaderButton, LoadMoreRow } from "@better-giving/ui";
import { Folder } from "lucide-react";
import { href, NavLink, useSearchParams } from "react-router";
import type { IPaginator } from "#/types/components";
import { toPP } from "@/helpers/date";
import type { IReg, TStatus } from "@/reg";
import { Progress } from "@/reg/progress";
import type { TRegsSortKey } from "@/reg/schema";

interface Props extends IPaginator<IReg> {
  empty_msg?: string;
  /** the `STRIPE_CONNECT_ROUTING` switch, for each draft's step dots */
  connect_routing: boolean;
}

const step_labels = ["Contact", "Org", "Agreement", "Banking"];

export function Table({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
  empty_msg = "No applications found",
  connect_routing,
}: Props) {
  const [params, setParams] = useSearchParams();
  const sort_key = (params.get("sort_key") ?? "updated_at") as TRegsSortKey;
  const sort_dir = (params.get("sort_dir") ?? "desc") as "asc" | "desc";

  const handle_sort = (key: TRegsSortKey) => () => {
    const copy = new URLSearchParams(params);
    if (key === sort_key) {
      copy.set("sort_dir", sort_dir === "asc" ? "desc" : "asc");
    } else {
      copy.set("sort_key", key);
      copy.set("sort_dir", "desc");
    }
    copy.delete("next");
    setParams(copy);
  };

  return (
    <div className={`${classes} table-scroll`}>
      <table className="table">
        <thead>
          <tr className="whitespace-nowrap">
            <th>
              <HeaderButton
                onClick={handle_sort("o_name")}
                _activeSortKey={sort_key}
                _sortKey={"o_name" as any}
                _sortDirection={sort_dir}
              >
                Nonprofit name
              </HeaderButton>
            </th>
            <th>
              <HeaderButton
                onClick={handle_sort("updated_at")}
                _activeSortKey={sort_key}
                _sortKey={"updated_at" as any}
                _sortDirection={sort_dir}
              >
                Date submitted
              </HeaderButton>
            </th>
            <th>
              <HeaderButton
                onClick={handle_sort("o_hq_country")}
                _activeSortKey={sort_key}
                _sortKey={"o_hq_country" as any}
                _sortDirection={sort_dir}
              >
                HQ country
              </HeaderButton>
            </th>
            <th>
              <HeaderButton
                onClick={handle_sort("status")}
                _activeSortKey={sort_key}
                _sortKey={"status" as any}
                _sortDirection={sort_dir}
              >
                Registration status
              </HeaderButton>
            </th>
            <th>
              <span className="flex justify-center">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={5}>{empty_msg}</EmptyRow>
          ) : (
            items.map((row) => (
              <tr key={row.id} className="text-sm">
                <td>{row.o_name}</td>
                <td className="whitespace-nowrap">{toPP(row.updated_at)}</td>
                <td>{row.o_hq_country}</td>
                <td>
                  <Status
                    status={row.status}
                    reg={row}
                    connect_routing={connect_routing}
                  />
                </td>
                <td>
                  <NavLink
                    to={
                      row.status === "01"
                        ? href("/register/:reg_id", { reg_id: row.id })
                        : href("/platform/applications/:id", { id: row.id })
                    }
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

const dot_color: { [key in TStatus]: string } = {
  "03": "bg-success",
  "02": "bg-warning",
  "04": "bg-destructive",
  "01": "bg-gray-11",
};

const text_color: { [key in TStatus]: string } = {
  "03": "text-success-subtle-fg",
  "02": "text-warning-subtle-fg",
  "04": "text-destructive-subtle-fg",
  "01": "text-gray-11",
};

const text: { [key in TStatus]: string } = {
  "03": "Approved",
  "02": "Pending",
  "04": "Rejected",
  "01": "Incomplete",
};

interface IStatusProps {
  status: TStatus;
  reg: IReg;
  connect_routing: boolean;
}

function Status({ status, reg, connect_routing }: IStatusProps) {
  const progress = status === "01" ? new Progress(reg, connect_routing) : null;

  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <span
        className={`${text_color[status]} inline-flex items-center gap-1.5 text-xs font-medium capitalize`}
      >
        <span
          className={`${dot_color[status]} size-2 rounded-full inline-block shrink-0`}
        />
        {text[status]}
      </span>
      {progress && (
        <div
          className="flex items-center gap-1"
          title={`Step ${progress.step} of 5`}
        >
          {progress.steps.map((done, i) => (
            <div
              key={i}
              className={`h-1 w-3 rounded-full ${done ? "bg-primary" : "bg-gray-4"}`}
              title={`${step_labels[i]}: ${done ? "done" : "pending"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
