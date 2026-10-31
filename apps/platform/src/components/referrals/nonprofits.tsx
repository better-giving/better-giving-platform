import { EmptyState } from "@better-giving/ui";
import { format } from "date-fns";
import { href, Link } from "react-router";
import type { Referred } from "#/types/referrals";
import { humanize } from "@/helpers/decimal";

interface Props {
  classes?: string;
  npos: Referred[];
}

export function Nonprofits({ classes = "", npos }: Props) {
  const rows = npos.map((npo) => {
    const now = new Date();
    const expiry = new Date(npo.up_until);

    return (
      <tr key={npo.id}>
        <td className="text-sm">
          <Link
            to={href("/org/:org", { org: npo.id.toString() })}
            className="link"
          >
            {npo.name}
          </Link>
        </td>
        <td className="text-sm">${humanize(npo.ltd)}</td>
        <td
          className={`text-sm ${now > expiry ? "text-destructive-subtle-fg" : "text-success-subtle-fg"}`}
        >
          {now > expiry ? "Ended" : `ends in ${format(expiry, "PP")}`}
        </td>
      </tr>
    );
  });
  return (
    <div className={classes}>
      <h2 className="text-2xl mb-4">Onboarded Nonprofits</h2>
      {rows.length > 0 ? (
        <div className="table-scroll card">
          <table className="min-w-full [&_th,&_td]:p-2 [&_th,&_td]:first:pl-0 [&_th,&_td]:text-left [&_tbody]:divide-y [&_tbody]:divide-hairline divide-y divide-hairline">
            <thead>
              <tr>
                <th>Name</th>
                <th>Earnings</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No nonprofits onboarded yet</EmptyState>
      )}
    </div>
  );
}
