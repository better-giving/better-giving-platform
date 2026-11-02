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
              <th>Raised / Goal</th>
              <th className="text-right">Donations</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyRow col_span={6}>
                No {status === "all" ? "" : status} forms found
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
              col_span={6}
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
      {/* form name + tag → links to edit */}
      <td>
        <NavLink
          to={href("/forms/:id/edit", { id: f.id })}
          className="font-medium link"
        >
          {f.name}
        </NavLink>
        {f.tag && (
          <p className="flex items-center gap-1 text-xs text-gray-11 mt-0.5">
            <TagIcon className="shrink-0 icon-xs" />
            {f.tag}
          </p>
        )}
      </td>

      {/* status */}
      <td>
        <StatusBadge status={f.status} />
      </td>

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
