import { to_usd } from "@better-giving/ui/helpers";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* recharts paints legend and tooltip text with the series' own stroke, so a
   band's plot colour doubles as its label ink unless it is overridden here.
   they are different rungs and have to stay different: the band is drawn with
   a fill and a border step, the label is step 11, the scale's text rung. the
   pdf sibling splits them the same way. hex is hand-copied from colors.css,
   as everywhere a chart is drawn from js — nothing guards that drift. */
const series = {
  savings: { label: "Donation Processing Savings", ink: "#008057" },
  liq: { label: "Savings Returns", ink: "#ac6500" },
  lock: { label: "Investment Returns", ink: "#206fad" },
  total: { label: "Total Financial Advantage", ink: "#206fad" },
} as const;

const ink = (key: unknown): string | undefined =>
  series[key as keyof typeof series]?.ink;

interface Point {
  year: string;
  amount: number;
  liq: number;
  savings: number;
  lock: number;
  total: number;
}
interface Props {
  points: Point[];
}

/* the default tooltip drops a row's name unless the formatter hands back a
   string (`isNumOrStr` gates the name span AND the separator), so per-row ink
   cannot come from a formatter — the rows are rendered here instead. */
function TooltipRows({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card rounded-card shadow-floating px-3 py-2 text-[13px]">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: ink(entry.dataKey) }}>
          {series[entry.dataKey as keyof typeof series]?.label ??
            String(entry.name)}{" "}
          : {to_usd(Number(entry.value))}
        </p>
      ))}
    </div>
  );
}
export function Chart({ points }: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} dy={4} />
        <YAxis
          dx={4}
          tick={{ fontSize: 12 }}
          tickFormatter={(value) => {
            if (value >= 1000000) {
              return `$${(value / 1000000).toFixed(1)}M`;
            }
            if (value >= 1000) {
              return `$${(value / 1000).toFixed(0)}K`;
            }
            return `$${value}`;
          }}
        />
        <Tooltip content={<TooltipRows />} />
        <Legend
          iconSize={10}
          iconType="circle"
          wrapperStyle={{ fontSize: 13 }}
          formatter={(value: any, entry: any) => (
            <span style={{ color: ink(entry?.dataKey) }}>{value}</span>
          )}
        />

        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="savings"
          stackId="1"
          name="Donation Processing Savings"
          fill="#b0ddc6"
          stroke="#0e8c62"
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="liq"
          stackId="1"
          name="Savings Returns"
          fill="#f19a00"
          stroke="#f59e0b"
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="lock"
          stackId="1"
          name="Investment Returns"
          fill="#b0d6fb"
          stroke="#6daee9"
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="total"
          name="Total Financial Advantage"
          strokeWidth={2}
          stroke="#1e6dab"
          fill="none"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
