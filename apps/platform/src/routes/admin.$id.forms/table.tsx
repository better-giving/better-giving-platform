import { EmptyRow, LoadMoreRow, Target } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { TagIcon } from "lucide-react";
import { href, NavLink } from "react-router";
import {
  type FormStatusFilter,
  StatusBadge,
  StatusFilter,
} from "#/components/forms-table/status";
import type { IPaginator } from "#/types/components";
import { toPP } from "@/helpers/date";
import type { IFormListed } from "$/pg/queries/form";

interface Props extends IPaginator<IFormListed> {
  status: string;
}

export function FormsTable({
  items,
  load_next,
  loading,
  disabled,
  status,
  classes = "",
}: Props) {
  return (
    <div className={classes}>
      <div className="table-scroll">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Form</th>
              <th>
                <StatusFilter value={status as FormStatusFilter} />
              </th>
              <th>Program</th>
              <th>Raised / Goal</th>
              <th className="text-right">Donations</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyRow
                col_span={7}
                heading={
                  status === "all"
                    ? "No forms found"
                    : `No ${status} forms found`
                }
              >
                {status === "all"
                  ? "Forms you create will show up here."
                  : "Try another status."}
              </EmptyRow>
            ) : (
              items.map((f) => (
                <tr key={f.id}>
                  <Row {...f} />
                </tr>
              ))
            )}
          </tbody>
          {load_next && (
            <LoadMoreRow
              col_span={7}
              disabled={disabled}
              loading={loading}
              on_load_next={load_next}
            />
          )}
        </table>
      </div>
    </div>
  );
}

function Row(f: IFormListed) {
  const target = f.target_smart ? "smart" : (f.target_number ?? null);
  return (
    <>
      {/* form tag/name → links to edit */}
      <td>
        <div className="flex items-center gap-2">
          <TagIcon className="shrink-0 text-gray-11 icon-sm" />
          <NavLink
            to={href("/forms/:id/edit", { id: f.id })}
            className="font-medium link"
          >
            {f.tag || f.name}
          </NavLink>
        </div>
      </td>

      {/* status */}
      <td>
        <StatusBadge status={f.status} />
      </td>

      {/* program */}
      <td className="text-gray-11">{f.program_name || "—"}</td>

      {/* raised / goal */}
      <td>
        {target !== null ? (
          <Target.Inline target={target} progress={f.ltd ?? 0} />
        ) : (
          <span className="text-sm text-gray-11">{to_usd(f.ltd ?? 0)}</span>
        )}
      </td>

      {/* donation count */}
      <td className="text-right figures">
        {f.donation_count.toLocaleString()}
      </td>

      {/* created */}
      <td className="whitespace-nowrap text-gray-11">
        {f.date_created ? toPP(f.date_created) : "—"}
      </td>

      {/* actions */}
      <td className="text-right">
        {f.status === "active" && (
          <NavLink
            to={`${f.id}/disable`}
            className="text-destructive-subtle-fg hover:text-destructive-subtle-fg text-xs font-medium"
          >
            Disable
          </NavLink>
        )}
      </td>
    </>
  );
}
