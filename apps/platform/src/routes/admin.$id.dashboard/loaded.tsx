import { EmptyState } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import {
  Arrow as HoverArrow,
  Content as HoverContent,
} from "@better-giving/ui/hover-card";
import { Arrow, Content } from "@better-giving/ui/tooltip";
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
} from "lucide-react";
import { NavLink } from "react-router";
import { Cell, Pie, PieChart } from "recharts";
import { category_colors } from "#/pages/admin/ticker-category-colors";
import { use_admin_data } from "#/pages/admin/use-admin-data";
import type { TickerCategory } from "@/nav/interfaces";
import { group_by_category } from "@/nav/interfaces";
import { min_payout_amount } from "@/npo/schema";
import type { DashboardData } from "./api";
import { GrantsTable } from "./common/grants-table";
import { PayoutsTable } from "./common/payouts-table";
import { Figure } from "./figure";
import { Payout } from "./payout";

interface Props extends DashboardData {
  classes?: string;
}

export function Loaded({ classes = "", ...props }: Props) {
  const data = use_admin_data();
  const payout_min = data?.endow.payout_minimum ?? min_payout_amount;

  return (
    <div className={classes}>
      <div className="grid gap-4 @lg:grid-cols-2">
        <Figure
          title="Savings"
          to="../savings"
          tooltip={
            <Content className="text-sm max-w-xs">
              Funds held in Fidelity Government Money Market (SPAXX) consisting
              of cash, US Government Securities and Repurchase Agreements
              <Arrow />
            </Content>
          }
          amount={to_usd(props.bal_liq, 2)}
        />
        <Figure
          title="Investments"
          to="../investments"
          hover_content={
            <HoverContent className="text-sm w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto scrollbars">
              <span className="block mb-2 font-medium">
                Portfolio composition
              </span>
              {(() => {
                const groups = group_by_category(
                  props.composition,
                  props.total_inv_value
                ).filter((g) => g.pct > 0);
                const pie_data = groups.map((g) => ({
                  category: g.category,
                  pct: g.pct,
                }));
                return (
                  <>
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
                                  category_colors[
                                    g.category as TickerCategory
                                  ] ?? category_colors.other,
                              }}
                            />
                            {g.category.replace("_", " ")}
                          </span>
                          <span>{g.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
              <HoverArrow />
            </HoverContent>
          }
          amount={to_usd(props.bal_lock, 2)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <NavLink to="deposit" className="btn btn-secondary gap-2 min-w-0">
          <ArrowUpFromLineIcon className="icon-md" />
          Deposit
        </NavLink>
        <NavLink to="withdraw" className="btn btn-secondary gap-2 min-w-0">
          <ArrowDownToLineIcon className="icon-md" />
          Withdraw
        </NavLink>
        <NavLink to="transfer" className="btn btn-secondary gap-2 min-w-0">
          <ArrowLeftRightIcon className="icon-md" />
          Transfer
        </NavLink>
      </div>

      {/** div scopes when the sticky header ends */}
      <div className="@container/period mt-10 grid gap-6">
        <section className="card">
          <div className="flex items-center gap-x-2 mb-2">
            <h4 className="text-lg">Grant items</h4>
            {props.recent_payouts.items.length > 0 && (
              <NavLink to="payouts" className="text-primary text-sm">
                see all
              </NavLink>
            )}
          </div>

          {props.recent_payouts.items.length > 0 ? (
            <PayoutsTable
              classes="mt-2 mb-3"
              items={props.recent_payouts.items}
            />
          ) : (
            <EmptyState
              classes="mt-2 mb-3"
              heading="No grant items yet"
              icon={<ArrowUpFromLineIcon className="icon-xl" />}
            >
              Grant items will show up here.
            </EmptyState>
          )}

          {props.recent_payouts.items.length > 0 && (
            <Payout
              next_payout={props.next_payout}
              bal_cash={props.bal_cash}
              threshold={payout_min}
              pm={props.pm}
              classes=""
            />
          )}
        </section>

        <section className="card">
          <div className="flex items-center gap-x-2 mb-2">
            <h4 className="text-lg">Payout history</h4>
            {props.recent_settlements.next &&
              props.recent_settlements.items.length > 0 && (
                <NavLink to="grants" className="text-primary text-sm">
                  see all
                </NavLink>
              )}
          </div>
          {props.recent_settlements.items.length > 0 ? (
            <GrantsTable items={props.recent_settlements.items} />
          ) : (
            <EmptyState
              heading="No payout records yet"
              icon={<ArrowDownToLineIcon className="icon-xl" />}
            >
              Payout records will show up here.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
