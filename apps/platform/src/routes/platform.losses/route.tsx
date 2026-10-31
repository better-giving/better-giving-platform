import { EmptyState } from "@better-giving/ui";
import { Link } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { LogsTable } from "#/pages/platform-admin/losses/logs-table";
import { humanize } from "@/helpers/decimal";
import type { Route } from "./+types/route";
import type { NpoLoss } from "./api";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () => metas({ title: "Losses" });

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { logs, logs_next, ltd, npo_losses } = loaderData;
  const total = ltd?.total ?? 0;

  return (
    <div className="px-6 py-4 md:px-10 md:py-8 w-full max-w-4xl grid content-start gap-6">
      <h3 className="font-bold text-2xl">Losses</h3>

      {/* summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card label="Total Losses" value={total} />
      </div>

      {/* per-npo breakdown */}
      <section className="card">
        <h4 className="font-bold text-lg mb-1">Losses per nonprofit</h4>
        {npo_losses.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>NPO</th>
                  <th className="text-right">Loss</th>
                </tr>
              </thead>
              <tbody>
                {npo_losses.map((n: NpoLoss) => (
                  <tr key={n.id} className="text-sm">
                    <td className="truncate max-w-56" title={n.name}>
                      {n.name}
                    </td>
                    <td className="text-right font-medium">
                      ${humanize(n.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No per-NPO data yet</EmptyState>
        )}
      </section>

      {/* recent loss logs */}
      <section className="card">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-lg mb-1">Recent loss logs</h4>
          {logs_next && (
            <Link to="logs" className="text-sm link">
              See All
            </Link>
          )}
        </div>
        {logs.length > 0 ? (
          <LogsTable items={logs} />
        ) : (
          <EmptyState>No loss logs yet</EmptyState>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-gray-11 text-sm mb-1">{label}</p>
      <p className="text-xl font-bold">${humanize(value)}</p>
    </div>
  );
}
