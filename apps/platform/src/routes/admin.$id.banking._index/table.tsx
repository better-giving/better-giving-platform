import { Badge, type BadgeVariant } from "@better-giving/ui";
import { FolderIcon } from "lucide-react";
import { NavLink } from "react-router";
import type { IBapp, TStatus } from "@/banking";
import { toPP } from "@/helpers/date";

type Props = {
  methods: IBapp[];
  classes?: string;
};

export function Table({ methods, classes = "" }: Props) {
  return (
    <table className={`${classes} table`}>
      <thead>
        <tr>
          <th>Date submitted</th>
          <th>Account</th>
          <th className="text-center">Status</th>
          <th className="text-center">Details</th>
        </tr>
      </thead>
      <tbody>
        {methods.map((row) => (
          <tr key={row.id} className="text-sm">
            <td>{toPP(row.date_created)}</td>
            <td>{row.bank_summary}</td>
            <td className="text-center">
              <Status status={row.status} />
            </td>
            <td>
              <NavLink
                to={row.id}
                className="[.pending]:text-gray-11 text-center w-full inline-block link"
              >
                <FolderIcon
                  aria-label="bank statement file"
                  className="inline-block icon-xl"
                />
              </NavLink>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tone: { [key in TStatus]: BadgeVariant } = {
  default: "primary",
  approved: "success",
  "under-review": "neutral",
  rejected: "destructive",
};

const text: { [key in TStatus]: string } = {
  default: "Default",
  "under-review": "Under review",
  rejected: "Rejected",
  approved: "Approved",
};

function Status({ status }: { status: TStatus }) {
  return <Badge variant={tone[status]}>{text[status]}</Badge>;
}
