import { EmptyState } from "@better-giving/ui";
import { format } from "date-fns";
import { href, Link, Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { Money } from "#/components/money";
import type { TInterval } from "@/subscriptions";
import type { Route } from "./+types/route";
import { SubStatus } from "./sub-status";

export { ErrorBoundary } from "#/components/error";
export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

type TFilter = "all" | "active" | "inactive";

const FILTERS: { key: TFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Cancelled" },
  { key: "all", label: "All" },
];

function interval_label(interval: TInterval, count: number): string {
  if (count > 1) return `Every ${count} ${interval}s`;
  switch (interval) {
    case "day":
      return "Daily";
    case "week":
      return "Weekly";
    case "month":
      return "Monthly";
    case "year":
      return "Annually";
  }
}

export default CacheRoute(Page);
function Page({ loaderData: { subs } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const raw = params.get("status");
  const filter: TFilter = raw === "all" || raw === "inactive" ? raw : "active";

  const visible = subs.filter((s) =>
    filter === "all" ? true : s.status === filter
  );

  const rows = visible.map((s) => {
    const can_cancel = s.status === "active";

    return (
      <tr key={s.id}>
        <td className="text-sm">
          <Link
            to={
              s.to_fund_id
                ? href("/campaigns/:fund_id", { fund_id: s.to_fund_id })
                : href("/org/:org", { org: String(s.to_npo_id) })
            }
            className="link"
          >
            {s.to_name}
          </Link>
        </td>
        <td className="text-sm">
          <Money
            amount={s.amount}
            currency={s.currency}
            amount_usd={s.amount_usd}
          />
          <div className="text-xs mt-1">
            {interval_label(s.interval, s.interval_count)}
          </div>
        </td>
        <td>
          <SubStatus status={s.status} />
          {s.status === "inactive" && (
            <div className="text-xs text-gray-11">
              {format(new Date(s.updated_at), "PP")}
            </div>
          )}
          {/* a narrow table folds the actions column in here, so Cancel is
              never past the scroller's edge */}
          {can_cancel && (
            <div className="@lg:hidden">
              <CancelLink
                sub_id={s.id}
                to_name={s.to_name}
                classes="-ml-2 mt-1"
              />
            </div>
          )}
        </td>

        <td className="text-sm">
          {s.status === "active" ? format(new Date(s.next_billing), "PP") : "—"}
        </td>

        <td className="text-sm @max-lg:hidden">
          {can_cancel ? <CancelLink sub_id={s.id} to_name={s.to_name} /> : null}
        </td>
      </tr>
    );
  });

  return (
    <div className="grid px-4 py-4 md:px-10 md:py-8">
      <h1 className="sr-only">Recurring donations</h1>
      <div
        role="tablist"
        className="inline-flex gap-1 rounded p-1 bg-gray-3 w-fit"
      >
        {FILTERS.map((f) => {
          const active = f.key === filter;
          const next = new URLSearchParams(params);
          next.set("status", f.key);
          return (
            <Link
              key={f.key}
              role="tab"
              aria-selected={active}
              to={`?${next.toString()}`}
              preventScrollReset
              className={`px-3 py-1 text-sm rounded ${
                active
                  ? "bg-secondary-active text-gray-12"
                  : "text-gray-11 hover:bg-gray-4 hover:text-gray-12"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length > 0 ? (
        <div className="table-scroll mt-6">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Next payment</th>
                <th scope="col" className="@max-lg:hidden">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <div className="card mt-6">
          <EmptyState>
            {filter === "inactive"
              ? "No cancelled donations found"
              : filter === "active"
                ? "No active recurring donations found"
                : "No recurring donations found"}
          </EmptyState>
        </div>
      )}
      {/** cancel prompt */}
      <Outlet />
    </div>
  );
}

interface ICancelLink {
  sub_id: string;
  /** names the row's recipient, so each row's Cancel is told apart */
  to_name: string;
  classes?: string;
}

function CancelLink({ sub_id, to_name, classes = "" }: ICancelLink) {
  return (
    <Link
      to={`cancel/${sub_id}`}
      aria-label={`Cancel ${to_name}`}
      className={`${classes} inline-block px-2 py-1 rounded text-xs font-bold text-destructive-subtle-fg hover:bg-red-4 active:bg-destructive-subtle-active focus-visible:outline-2 focus-visible:outline-ring`}
    >
      Cancel
    </Link>
  );
}
