import { EmptyRow } from "@better-giving/ui";
import { Link } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { LogsTable } from "#/pages/platform-admin/revenue/logs-table";
import { humanize } from "@/helpers/decimal";
import type { IRevenueLtd } from "@/revenue";
import type { Route } from "./+types/route";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () => metas({ title: "Revenue" });

const empty_ltd: IRevenueLtd = {
  tip: 0,
  base_fee: 0,
  fsa_fee: 0,
};

function ltd_total(l: IRevenueLtd) {
  return l.tip + l.base_fee + l.fsa_fee;
}

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { logs, logs_next, ltd: _ltd, npo_ltds } = loaderData;
  const ltd = { ...empty_ltd, ..._ltd };
  const total = ltd_total(ltd);

  return (
    <div className="px-6 py-4 md:px-10 md:py-8 w-full max-w-[1400px] grid content-start">
      <h1 className="text-3xl font-bold mb-4">Revenue</h1>

      {/* summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card label="Total Revenue" value={total} />
        <Card label="Tips" value={ltd.tip} />
        <Card label="Base Fees" value={ltd.base_fee} />
        <Card label="FSA Fees" value={ltd.fsa_fee} />
      </div>

      {/* per-npo breakdown */}
      <h2 className="font-bold text-lg mt-8 mb-1">Revenue per nonprofit</h2>
      <div className="table-scroll">
        <table className="table w-full">
          <thead>
            <tr>
              <th>NPO</th>
              <th className="text-right">Tips</th>
              <th className="text-right">Base Fees</th>
              <th className="text-right">FSA Fees</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {npo_ltds.map((n) => (
              <tr key={n.id} className="text-sm">
                <td className="truncate max-w-56" title={n.name}>
                  {n.name}
                </td>
                <td className="text-right">${humanize(n.tip)}</td>
                <td className="text-right">${humanize(n.base_fee)}</td>
                <td className="text-right">${humanize(n.fsa_fee)}</td>
                <td className="text-right font-medium">
                  ${humanize(n.tip + n.base_fee + n.fsa_fee)}
                </td>
              </tr>
            ))}
            {npo_ltds.length === 0 && (
              <EmptyRow col_span={5}>No per-NPO data yet</EmptyRow>
            )}
          </tbody>
          {npo_ltds.length > 0 && (
            <tfoot>
              <tr className="text-sm font-medium">
                <td>Total</td>
                <td className="text-right">${humanize(ltd.tip)}</td>
                <td className="text-right">${humanize(ltd.base_fee)}</td>
                <td className="text-right">${humanize(ltd.fsa_fee)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* audit trail */}
      <div className="flex items-center justify-between mt-8">
        <h2 className="font-bold text-lg mb-1">Recent revenues</h2>
        {logs_next && (
          <Link to="logs" className="text-sm link">
            See All
          </Link>
        )}
      </div>
      <LogsTable items={logs} />
    </div>
  );
}

interface CardProps {
  label: string;
  value: number;
  dollar?: boolean;
}
function Card({ label, value, dollar = true }: CardProps) {
  return (
    <div className="card">
      <p className="text-gray-11 text-sm mb-1">{label}</p>
      <p className="text-xl font-bold">
        {dollar ? "$" : ""}
        {humanize(value)}
      </p>
    </div>
  );
}
