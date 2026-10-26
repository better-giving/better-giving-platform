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
        </td>

        <td className="text-sm">
          {s.status === "active" ? format(new Date(s.next_billing), "PP") : "—"}
        </td>

        <td className="text-sm">
          {can_cancel ? (
            <Link
              to={`cancel/${s.id}`}
              className="inline-block px-2 py-1 rounded text-xs font-bold uppercase text-destructive-subtle-fg hover:bg-destructive-subtle active:bg-destructive-subtle-active"
            >
              Cancel
            </Link>
          ) : null}
        </td>
      </tr>
    );
  });

  return (
    <div className="grid px-6 py-4 md:px-10 md:py-8">
      <h2 className="text-3xl">Recurring Donations</h2>

      <div
        role="tablist"
        className="mt-6 inline-flex gap-1 border border-gray-6 rounded p-1 bg-panel w-fit"
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
                  ? "bg-primary text-primary-fg"
                  : "text-gray-11 hover:text-gray-12"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length > 0 ? (
        <div className="table-scroll bg-panel rounded mt-6">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Next Payment</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <EmptyState classes="mt-6">
          {filter === "inactive"
            ? "No cancelled donations found"
            : filter === "active"
              ? "No active recurring donations found"
              : "No recurring donations found"}
        </EmptyState>
      )}
      {/** cancel prompt */}
      <Outlet />
    </div>
  );
}
