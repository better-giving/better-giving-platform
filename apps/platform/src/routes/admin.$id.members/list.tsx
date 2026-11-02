import { Outlet } from "react-router";
import type { LoaderData } from "./api";
import { DeleteForm } from "./delete-form";

interface IList extends LoaderData {}
export function List(props: IList) {
  return (
    <div className="table-scroll">
      <Loaded {...props} />
      {/** render add form */}
      <Outlet />
    </div>
  );
}

interface LoadedProps extends LoaderData {
  classes?: string;
}
function Loaded({ admins, classes = "", user }: LoadedProps) {
  return (
    <table className={`${classes} table`}>
      <thead>
        <tr>
          <th className="w-8" />
          <th>Email</th>
          <th>First name</th>
          <th>Last name</th>
        </tr>
      </thead>
      <tbody>
        {admins.map((member) => (
          <tr key={member.email} className="text-sm">
            <td>
              {member.id !== user.id && (
                <DeleteForm
                  to_remove={member.id}
                  pending_email={member.pending ? member.email : undefined}
                  label={member.email}
                />
              )}
            </td>
            <td>
              {member.email}
              {member.pending && (
                <span className="ml-2 text-xs text-warning-subtle-fg">
                  • Pending
                </span>
              )}
            </td>
            <td>{member.first_name ?? "-"}</td>
            <td>{member.last_name ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
