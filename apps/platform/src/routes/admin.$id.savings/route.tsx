import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  CircleHelp,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { humanize } from "@/helpers/decimal";
import type { Route } from "./+types/route";
import { Txs } from "./txs";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Savings", matches);

export default CacheRoute(Page);

function Page({ loaderData }: Route.ComponentProps) {
  const { bal_liq, ...btxs_page1 } = loaderData;
  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full max-w-4xl grid content-start">
      <h1 className="sr-only">Savings</h1>
      <div className="card">
        <div className="flex items-center mb-2">
          <p className="text-sm font-medium text-gray-11">Savings</p>
          <Tooltip
            tip={
              <Content className="text-sm max-w-xs">
                Funds held in Fidelity Government Money Market (SPAXX)
                consisting of cash, US Government Securities and Repurchase
                Agreements
                <Arrow />
              </Content>
            }
          >
            <CircleHelp className="text-gray-11 ml-1 icon-sm" />
          </Tooltip>
        </div>
        <p className="text-xl font-semibold">${humanize(bal_liq)}</p>
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
      <Outlet />
    </div>
  );
}
