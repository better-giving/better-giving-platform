import { LoadMoreRow } from "@better-giving/ui";
import { href, NavLink } from "react-router";
import type { IPaginator } from "#/types/components";
import { toPP } from "@/helpers/date";
import type { IFundListItem } from "$/pg/queries/fund";
import { DeleteBtn } from "./delete-btn";

interface Props extends IPaginator<IFundListItem> {}

export function Table({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
}: Props) {
  return (
    <table className={`${classes} table`}>
      <thead>
        <tr>
          <th>Date created</th>
          <th>Name</th>
          <th>Creator</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((row) => (
          <tr key={row.id} className="text-sm">
            <td>{row.created_at ? toPP(row.created_at) : "--"}</td>
            <td>
              <NavLink
                to={href("/campaigns/:fund_id", { fund_id: row.id })}
                className="link [.pending]:text-gray-11 [.pending]:pointer-events-none"
              >
                {row.name}
              </NavLink>
            </td>
            <td>{row.creator_id}</td>
            <td>
              <DeleteBtn fund_id={row.id} name={row.name} />
            </td>
          </tr>
        ))}
      </tbody>
      {load_next && (
        <LoadMoreRow
          col_span={4}
          disabled={disabled}
          loading={loading}
          on_load_next={load_next}
        />
      )}
    </table>
  );
}
