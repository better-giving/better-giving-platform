import { EmptyState } from "@better-giving/ui";
import { format } from "date-fns";
import { Link, NavLink, Outlet } from "react-router";
import {
  Legend,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { NpoName } from "#/components/npo-name";
import { metas } from "#/helpers/seo";
import { BalanceHistoryTable } from "#/pages/platform-admin/savings/history-table-balance";
import { InterestHistoryTable } from "#/pages/platform-admin/savings/history-table-interest";
import { humanize } from "@/helpers/decimal";
import type { Route } from "./+types/route";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () => metas({ title: "Savings" });
function top_holders_fn(holders: Record<string, number>) {
  return Object.entries(holders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { logs_intr, logs_intr_next, logs_bal, logs_bal_next } = loaderData;
  const ltd = logs_bal.at(0);

  const line_data = [...logs_bal].reverse().map((x) => {
    const { date, total } = x;
    return {
      date: format(new Date(date), "yyyy-MM-dd"),
      total,
    };
  });
  const num_holders = ltd ? Object.keys(ltd.balances).length : 0;
  const top_holders = ltd ? top_holders_fn(ltd.balances) : [];

  return (
    <div className="px-6 py-4 md:px-10 md:py-8 w-full max-w-4xl grid content-start gap-6">
      <h3 className="font-bold text-2xl">Savings</h3>

      {ltd ? (
        <>
          <div className="card">
            <p className="text-gray-11 text-sm mb-2">Total Value</p>
            <p className="text-3xl font-bold">${humanize(ltd.total)}</p>
          </div>

          <section className="card">
            <h4 className="font-bold text-lg mb-4 capitalize">
              Total savings balance
            </h4>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={line_data}
                margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
              >
                <Legend wrapperStyle={{ fontSize: 14, paddingTop: 10 }} />
                <XAxis dataKey="date" tick={{ fontSize: 12, dy: 4 }} />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  stroke="#1e6dab"
                  tick={{ fontSize: 12, dx: -4 }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="total"
                  stroke="#1e6dab"
                  name="Savings Balance"
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />

                <RechartsTooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(val, name) => [
                    `${humanize(val as number)}`,
                    name,
                  ]}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section className="card">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg">Recent balance snapshots</h4>
              {logs_bal_next && (
                <Link to="balance-history" className="text-sm link">
                  See All
                </Link>
              )}
            </div>
            <BalanceHistoryTable items={logs_bal} />
          </section>
        </>
      ) : (
        <div className="card">
          <EmptyState>No balance data yet</EmptyState>
        </div>
      )}

      <section className="card">
        <div className="flex items-center gap-x-2 mb-4">
          <h4 className="font-bold text-lg">Recent interests</h4>
          <NavLink
            replace
            preventScrollReset
            to="log-interest"
            className="btn btn-sm btn-primary"
          >
            Log Interest
          </NavLink>
          {logs_intr_next && (
            <Link to="interest-history" className="ml-auto text-sm link">
              See All
            </Link>
          )}
        </div>
        <InterestHistoryTable items={logs_intr} />
      </section>

      {top_holders.length > 0 && (
        <TopSavers holders={top_holders} total={num_holders} />
      )}
      <Outlet />
    </div>
  );
}

interface ITopSavers {
  holders: [string, number][];
  total: number;
}

function TopSavers({ holders, total }: ITopSavers) {
  return (
    <section className="card">
      <h5 className="font-bold text-base mb-2">
        Top savers <span className="text-sm text-gray-11">( of {total} )</span>
      </h5>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {holders.map(([holder, balance]) => (
              <tr key={holder} className="text-sm">
                <td>
                  <NpoName id={holder} />
                </td>
                <td className="text-right">${humanize(balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
