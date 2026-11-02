import {
  Arrow as HoverArrow,
  HoverCard,
  Content as HoverContent,
} from "@better-giving/ui/hover-card";
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  CircleHelp,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Cell, Pie, PieChart } from "recharts";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { category_colors } from "#/pages/admin/ticker-category-colors";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { humanize } from "@/helpers/decimal";
import type { TickerCategory } from "@/nav/interfaces";
import { group_by_category } from "@/nav/interfaces";
import type { Route } from "./+types/route";
import { SfPerf } from "./sf-perf";
import { Txs } from "./txs";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Investments", matches);

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { bal_lock, id, composition, total_inv_value, ...btxs_page1 } =
    loaderData;
  const groups = group_by_category(composition, total_inv_value).filter(
    (g) => g.pct > 0
  );
  const pie_data = groups.map((g) => ({
    category: g.category,
    pct: g.pct,
  }));
  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full max-w-4xl grid content-start">
      <h1 className="sr-only">Investments</h1>
      <div className="card">
        <div className="flex items-center mb-2">
          <p className="text-sm font-medium text-gray-11">Investments</p>
          <HoverCard
            tip={
              <HoverContent className="text-sm w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto scrollbars">
                <span className="block mb-2 font-medium">
                  Portfolio composition
                </span>
                <PieChart width={150} height={150} className="mx-auto">
                  <Pie
                    data={pie_data}
                    dataKey="pct"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={55}
                    strokeWidth={0}
                  >
                    {pie_data.map((d) => (
                      <Cell
                        key={d.category}
                        fill={
                          category_colors[d.category as TickerCategory] ??
                          category_colors.other
                        }
                      />
                    ))}
                  </Pie>
                </PieChart>
                {groups.map((g) => (
                  <div key={g.category} className="mb-2 last:mb-0">
                    <div className="flex items-center justify-between font-medium">
                      <span className="flex items-center gap-1.5 capitalize">
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              category_colors[g.category as TickerCategory] ??
                              category_colors.other,
                          }}
                        />
                        {g.category.replace("_", " ")}
                      </span>
                      <span>{g.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
                <HoverArrow />
              </HoverContent>
            }
          >
            <CircleHelp className="text-gray-11 ml-1 icon-sm" />
          </HoverCard>
        </div>
        <div className="text-xl font-semibold">
          ${humanize(bal_lock)} <SfPerf id={id} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-4">
        <NavLink to="deposit" className="btn btn-secondary gap-2">
          <ArrowUpFromLineIcon className="icon-md" />
          Deposit
        </NavLink>
        <NavLink to="withdraw" className="btn btn-secondary gap-2">
          <ArrowDownToLineIcon className="icon-md" />
          Withdraw
        </NavLink>
        <NavLink to="transfer" className="btn btn-secondary gap-2">
          <ArrowLeftRightIcon className="icon-md" />
          Transfer
        </NavLink>
      </div>
      <Txs page1={btxs_page1} classes="mt-8" />
      {/** prompts */}
      <Outlet />
    </div>
  );
}
