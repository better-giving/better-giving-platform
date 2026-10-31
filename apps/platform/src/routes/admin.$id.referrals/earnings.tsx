import { EmptyState, Info } from "@better-giving/ui";
import { endOfMonth, format, formatDistance } from "date-fns";
import { ArrowRightIcon, HistoryIcon } from "lucide-react";
import { Link, Outlet } from "react-router";
import {
  EarningsHistory,
  type Props as IEarningsHistory,
} from "#/pages/admin/referrals/earnings-table";
import type { IBapp } from "@/banking";
import { humanize } from "@/helpers/decimal";
import { config } from "./config";

interface Props {
  classes?: string;
  earnings: IEarningsHistory;
  pending_total: number;
  payout?: IBapp;
  payout_ltd: number;
  payout_min?: number;
}

export function Earnings({
  classes = "",
  earnings,
  pending_total,
  payout,
  payout_min = config.pay_min,
  payout_ltd,
}: Props) {
  const now = new Date();
  const end = endOfMonth(now);

  return (
    <div className={classes}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl capitalize">Earnings</h2>
        {earnings.see_all && (
          <Link to={earnings.see_all} className="text-sm link">
            View All
          </Link>
        )}
      </div>

      <div className="bg-card rounded-card shadow-card overflow-hidden">
        <div className="p-6 @container">
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <div className="flex items-center gap-x-2 flex-wrap">
              <div className="text-2xl font-bold">
                ${humanize(pending_total)}
              </div>
              <p className="text-sm text-gray-11 mt-1">
                pays out {format(end, "PP")}- in {formatDistance(end, now)}.
              </p>
            </div>
            <Link
              aria-disabled={payout_ltd === 0}
              to="payouts"
              className="group flex items-center @max-lg:mt-2 gap-x-1 link"
            >
              <HistoryIcon className="group-hover:hidden @max-lg:hidden icon-xl" />
              <ArrowRightIcon className=" @max-lg:hidden hidden @lg:group-hover:block group-active:translate-x-0.5 icon-xl" />
              <div className="text-xl font-bold text-gray-11">
                ${humanize(payout_ltd)}
              </div>
              <span className="text-sm mt-1">paid out</span>
            </Link>
          </div>
          {payout && (
            <div className="mt-4">
              <p className="text-sm text-gray-11">Payout threshold</p>
              <div className="flex gap-x-1 items-center">
                <p className="font-semibold text-warning-subtle-fg">
                  ${humanize(payout_min)}
                </p>
              </div>
            </div>
          )}
          {payout ? (
            <div className="mt-4">
              <p className="text-sm text-gray-11">Default Payout Method</p>

              <Link to="../banking" className="link">
                {payout.bank_summary}
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 mt-4">
              <Info>No default payout method</Info>
              <Link to="../banking" className="text-sm link">
                Setup
              </Link>
            </div>
          )}

          {earnings.items.length > 0 ? (
            <EarningsHistory {...earnings} classes="mt-6" />
          ) : (
            <EmptyState classes="mt-6">No earnings yet</EmptyState>
          )}
        </div>
      </div>
      {/** payout min form */}
      <Outlet />
    </div>
  );
}
