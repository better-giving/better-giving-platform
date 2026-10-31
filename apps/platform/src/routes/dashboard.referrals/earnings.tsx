import { EmptyState, ExtLink } from "@better-giving/ui";
import { endOfMonth, format, formatDistance } from "date-fns";
import { ArrowRightIcon, HistoryIcon, PencilIcon } from "lucide-react";
import { Link, Outlet } from "react-router";
import { config } from "#/pages/user-dashboard/referrals/config";
import {
  EarningsHistory,
  type Props as IEarningsHistory,
} from "#/pages/user-dashboard/referrals/earnings-table";
import { humanize } from "@/helpers/decimal";
import type { V2RecipientAccount } from "@/wise";

interface Props {
  classes?: string;
  earnings: IEarningsHistory;
  pending_total: number;
  payout: V2RecipientAccount | null;
  payout_ltd: number;
  payout_min?: number;
  w_form?: string;
}

export function Earnings({
  classes = "",
  earnings,
  pending_total,
  payout,
  payout_min = config.pay_min,
  payout_ltd,
  w_form,
}: Props) {
  const now = new Date();
  const end = endOfMonth(now);

  return (
    <div className={classes}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl capitalize">My earnings</h2>
        {earnings.see_all && (
          <Link to={earnings.see_all} className="text-sm link">
            View All
          </Link>
        )}
      </div>

      <div>
        <div className="@container">
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
                <Link
                  to={{ pathname: "payout-min", search: `?min=${payout_min}` }}
                  replace
                  preventScrollReset
                  aria-label="Edit payout threshold"
                  className="text-xs"
                >
                  <PencilIcon className="icon-xs" />
                </Link>
              </div>
            </div>
          )}
          {payout && w_form ? (
            <div className="mt-4">
              <p className="text-sm text-gray-11">Payout method</p>
              <div className="flex gap-x-2 items-center">
                <p className="text-sm">{payout.longAccountSummary}</p>
                <Link to="payout" className="btn btn-sm btn-primary">
                  Change
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-x-2">
              <Link
                to={w_form ? "payout" : "w-form"}
                className="btn btn-primary mt-2"
              >
                Setup Payout Method
              </Link>
              {w_form && <ExtLink download href={`/api/anvil-doc/${w_form}`} />}
            </div>
          )}

          {earnings.items.length > 0 ? (
            <EarningsHistory
              items={earnings.items}
              load_next={earnings.load_next}
              see_all={earnings.see_all}
              classes="mt-6"
            />
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
