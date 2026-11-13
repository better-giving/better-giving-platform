import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { format } from "date-fns";
import { InfoIcon } from "lucide-react";
import { href, Link } from "react-router";
import { cancelled_note } from "#/components/cancelled-note";
import type { IPaginator } from "#/types/components";
import { is_cancelled_duplicate } from "@/donations";
import { humanize } from "@/helpers/decimal";
import type { INpoDonation } from "$/pg/queries/dist";

export interface Props extends IPaginator<INpoDonation> {
  see_all?: string;
}
export function EarningsHistory({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
}: Props) {
  return (
    <div className={`${classes} table-scroll`}>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>NPO</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={3}>No earnings yet</EmptyRow>
          ) : (
            items.map((p, idx) => {
              // TODO: join referrer_commissions to get actual commission amount
              const amount = 0;

              const cancelled = is_cancelled_duplicate(
                p.donation_status,
                p.status
              );
              const status: "pending" | "paid" | "refunded" =
                p.status === "refunded" ? "refunded" : "pending";
              return (
                <tr key={idx}>
                  <td>{format(p.date_created, "PP")}</td>
                  <td>
                    <Link
                      to={href("/org/:org", {
                        org: String(p.to_id ?? 0),
                      })}
                    >
                      {p.to_name}
                    </Link>
                  </td>

                  <td>
                    <span
                      className={
                        status === "refunded"
                          ? "line-through text-destructive-subtle-fg"
                          : ""
                      }
                    >
                      ${humanize(amount)}
                    </span>
                    {status === "refunded" && (
                      <Tooltip
                        tip={
                          <Content className="max-w-xs text-xs">
                            <Arrow />
                            {cancelled
                              ? cancelled_note("referrer")
                              : "Refunded"}
                          </Content>
                        }
                      >
                        <InfoIcon className="inline ml-1 text-destructive icon-sm" />
                      </Tooltip>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={3}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}
