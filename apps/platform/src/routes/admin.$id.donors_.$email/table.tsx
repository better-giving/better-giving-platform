import { EmptyRow } from "@better-giving/ui";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { InfoIcon, RefreshCw, SparklesIcon } from "lucide-react";
import { useMemo } from "react";
import { cancelled_note } from "#/components/cancelled-note";
import { Money } from "#/components/money";
import { app_name } from "#/constants/env";
import { is_cancelled_duplicate } from "@/donations";
import { toPP } from "@/helpers/date";
import { humanize } from "@/helpers/decimal";
import type { ISub } from "@/subscriptions";
import type { ISubDist } from "$/pg/queries/subscription";
import { Fees } from "../admin.$id.donations/fees";
import { sub_color } from "./helpers";

interface IProps {
  dists: ISubDist[];
  subs: ISub[];
}

export function GiftsTable({ dists, subs }: IProps) {
  // sub.id -> { idx (for color), interval }
  const meta = useMemo(
    () => Object.fromEntries(subs.map((s, i) => [s.id, { sub: s, idx: i }])),
    [subs]
  );

  // tick number per sub dist (oldest = 1)
  const ticks = useMemo(() => {
    const t: Record<string, number> = {};
    const by_sub: Record<string, ISubDist[]> = {};
    for (const d of dists) {
      if (!d.subscription_id) continue;
      by_sub[d.subscription_id] ??= [];
      by_sub[d.subscription_id].push(d);
    }
    for (const ds of Object.values(by_sub)) {
      ds.sort((a, b) => (a.date_created < b.date_created ? -1 : 1));
      ds.forEach((d, i) => {
        t[d.id] = i + 1;
      });
    }
    return t;
  }, [dists]);

  return (
    <table className="table">
      <thead>
        <tr>
          <th className="w-px whitespace-nowrap" colSpan={3}>
            Date
          </th>
          <th>Amount</th>
          <th>
            <div className="flex items-center gap-x-1">
              <span>Fees </span>
              <Tooltip
                tip={
                  <Content className="max-w-sm text-sm">
                    <p className="text-xs font-semibold">
                      Base fee{" "}
                      <span className="text-primary text-xs font-bold">
                        1.5%
                      </span>
                    </p>
                    <p className="mb-4">
                      Charged when {app_name} tip screen is disabled at the time
                      of donation
                    </p>
                    <p className="text-xs font-semibold">
                      Fiscal sponsorship fee{" "}
                      <span className="text-primary text-xs font-bold">
                        2.9%
                      </span>
                    </p>
                    <p className="text-xs font-semibold mt-4">Processing fee</p>
                    <p>Charged by payment processor (Stripe, Chariot, etc.)</p>
                    <p>
                      Covered by donor
                      <SparklesIcon className="fill-success stroke-success ml-1 inline icon-xs" />
                    </p>
                    <Arrow />
                  </Content>
                }
              >
                <InfoIcon className="text-gray-11 icon-sm" />
              </Tooltip>
            </div>
          </th>
          <th>Net</th>
        </tr>
      </thead>
      <tbody>
        {dists.length === 0 && (
          <EmptyRow col_span={6}>No donations yet</EmptyRow>
        )}
        {dists.map((d) => {
          const m = d.subscription_id ? meta[d.subscription_id] : undefined;
          const total_fees =
            (d.fee_base ?? 0) + (d.fee_fsa ?? 0) + (d.fee_processing ?? 0);
          // the donor's own list marks a refunded gift the same way
          const refunded =
            d.status === "refunded" || d.status === "refunded_loss";
          const cancelled = is_cancelled_duplicate(d.donation_status, d.status);
          const strike = refunded
            ? "line-through text-destructive-subtle-fg"
            : "";
          return (
            <tr key={d.id}>
              <td className="w-px whitespace-nowrap pr-0">
                {toPP(d.sttl_date ?? d.date_created)}
              </td>
              <td className="w-px whitespace-nowrap px-1 border-l-0">
                {m && (
                  <RefreshCw
                    className="icon-sm"
                    style={{ color: sub_color(m.idx) }}
                  />
                )}
              </td>
              <td className="w-px whitespace-nowrap pl-0 border-l-0">
                {m && (
                  <span
                    className="text-xs font-semibold figures"
                    style={{ color: sub_color(m.idx) }}
                  >
                    {ticks[d.id]}
                  </span>
                )}
              </td>
              <td>
                {d.amount != null && d.amount_usd != null ? (
                  <Money
                    classes={strike}
                    amount={+d.amount}
                    currency={d.amount_denom}
                    amount_usd={+d.amount_usd}
                    chips={[
                      d.amount_tip_usd != null && d.amount_tip_usd > 0 && (
                        <Tooltip
                          key="tip"
                          tip={
                            <Content className="text-xs">
                              <p>Tip to {app_name}</p>
                              <Arrow />
                            </Content>
                          }
                        >
                          <span className="cursor-help text-xs font-semibold text-primary figures">
                            +${humanize(d.amount_tip_usd, 2)}
                          </span>
                        </Tooltip>
                      ),
                      d.amount_fee_allowance_usd != null &&
                        d.amount_fee_allowance_usd > 0 && (
                          <Tooltip
                            key="fa"
                            tip={
                              <Content className="text-xs">
                                <p>Processing fee covered by donor</p>
                                <Arrow />
                              </Content>
                            }
                          >
                            <span className="inline-flex cursor-help items-center gap-0.5 text-xs font-semibold text-gray-11 figures">
                              <SparklesIcon className="fill-success stroke-success icon-xs" />
                              ${humanize(d.amount_fee_allowance_usd, 2)}
                            </span>
                          </Tooltip>
                        ),
                    ]}
                  />
                ) : d.amount_usd != null ? (
                  <span className={strike}>${humanize(d.amount_usd, 2)}</span>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <Tooltip
                  tip={
                    <Content>
                      <Fees
                        base={d.fee_base ?? 0}
                        fsa={d.fee_fsa ?? 0}
                        processing={d.fee_processing ?? 0}
                        processing_allowance={d.fee_allowance ?? 0}
                      />
                      <Arrow />
                    </Content>
                  }
                >
                  <span
                    className={`cursor-help ${strike || "underline decoration-dotted"}`}
                  >
                    ${humanize(total_fees, 2)}
                  </span>
                </Tooltip>
              </td>
              <td>
                {d.net != null ? (
                  <>
                    <span className={strike}>${humanize(d.net, 2)}</span>
                    {cancelled && (
                      <Tooltip
                        tip={
                          <Content className="max-w-xs text-xs">
                            <Arrow />
                            {cancelled_note()}
                          </Content>
                        }
                      >
                        <InfoIcon className="inline ml-1 text-destructive icon-sm" />
                      </Tooltip>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
