import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { type ISub, monthly_amount } from "@/subscriptions";
import type { ISubDist } from "$/pg/queries/subscription";

interface IProps {
  subs: ISub[];
  dists: ISubDist[];
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function Stewardship({ subs, dists }: IProps) {
  const now = new Date();
  const year = now.getFullYear();
  const current_month = now.getMonth();
  const settled = dists.filter((d) => d.status === "settled");

  const data = Array.from({ length: 12 }, (_, mi) => {
    const m_start = new Date(year, mi, 1).getTime();
    const m_end = new Date(year, mi + 1, 1).getTime();

    let billed = 0;
    let pending = 0;
    let cancelled = 0;

    subs.forEach((s) => {
      const created = new Date(s.created_at).getTime();
      const m = monthly_amount(s.amount_usd, s.interval, s.interval_count);
      if (created >= m_end) return;

      // billed = donor gross charge (npo-credit + tip + fee_allowance).
      // matches sub pill (sub.amount_usd is donor commitment incl. expected tip + fa).
      const billed_for_sub = settled.reduce((acc, d) => {
        if (d.subscription_id !== s.id) return acc;
        const t = new Date(d.date_created).getTime();
        if (t < m_start || t >= m_end) return acc;
        return (
          acc +
          (d.amount_usd ?? 0) +
          (d.amount_tip_usd ?? 0) +
          (d.amount_fee_allowance_usd ?? 0)
        );
      }, 0);

      billed += billed_for_sub;
      if (s.status === "active" && mi >= current_month) {
        // top off pending so bar reaches monthly potential
        pending += Math.max(0, m - billed_for_sub);
      } else if (s.status === "inactive" && mi === current_month) {
        // cancelled subs: would-have-been billable for current month only
        cancelled += Math.max(0, m - billed_for_sub);
      }
    });

    return {
      month: MONTH_LABELS[mi],
      billed,
      pending,
      cancelled,
    };
  });

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <pattern
              id="cancelled_hatch"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--primary)"
                strokeWidth="2"
                opacity="0.6"
              />
            </pattern>
          </defs>
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: "var(--gray-11)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--gray-6)" }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--gray-3)", opacity: 0.3 }}
            content={<MonthTooltip />}
          />
          <Bar dataKey="billed" stackId="m" fill="var(--primary)" />
          <Bar dataKey="pending" stackId="m" fill="var(--secondary)" />
          <Bar dataKey="cancelled" stackId="m" fill="url(#cancelled_hatch)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface ITooltipProps {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number }[];
}

function MonthTooltip({ active, label, payload }: ITooltipProps) {
  if (!active || !payload?.length) return null;
  const current_month = new Date().getMonth();
  const month_idx = MONTH_LABELS.indexOf(label ?? "");
  const is_future = month_idx > current_month;
  const billed = payload.find((p) => p.dataKey === "billed")?.value ?? 0;
  const pending = payload.find((p) => p.dataKey === "pending")?.value ?? 0;
  const cancelled = payload.find((p) => p.dataKey === "cancelled")?.value ?? 0;
  if (billed === 0 && pending === 0 && cancelled === 0) return null;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div className="bg-card rounded-card shadow-floating p-2 text-xs">
      <p className="mb-1 font-semibold">{label}</p>
      {billed > 0 && (
        <p>
          <span className="text-gray-11">billed </span>
          <span className="font-medium">{fmt(billed)}</span>
        </p>
      )}
      {pending + cancelled > 0 && (
        <p>
          <span className="text-gray-11">
            {is_future ? "expected " : "pending "}
          </span>
          <span className="font-medium">{fmt(pending + cancelled)}</span>
        </p>
      )}
      {cancelled > 0 && (
        <p className="mt-1 text-gray-11">
          includes {fmt(cancelled)} cancelled this month
        </p>
      )}
    </div>
  );
}
