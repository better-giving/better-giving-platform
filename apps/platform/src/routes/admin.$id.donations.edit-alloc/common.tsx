import { Banknote, Sprout, Trees, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { IAllocation } from "@/donations";

export function to_alloc(input: string): IAllocation {
  const [a, b, c] = input.split("-").map((str) => Number.parseInt(str, 10));
  return { cash: a, liq: b, lock: c };
}

export function to_alloc_opt_value(input: IAllocation): string {
  const padNumber = (num: number): string => num.toString().padStart(3, "0");
  return `${padNumber(input.cash)}-${padNumber(input.liq)}-${padNumber(
    input.lock
  )}`;
}

/** one slot width for every option, so the labels share a left edge */
const icon_slot = (icon: ReactNode) => (
  <span className="grid place-items-center shrink-0 icon-2xl">{icon}</span>
);

export const alloc_opts = [
  {
    value: "000-000-100",
    label: "Endowment Builder",
    description: "100% Investment",
    icon: icon_slot(<Trees className="icon-2xl text-success" />),
  },
  {
    value: "000-025-075",
    label: "Long-Term Sustainability",
    description: "25% Savings, 75% Investment",
    icon: icon_slot(<Sprout className="icon-2xl text-success" />),
  },
  {
    value: "000-050-050",
    label: "Balanced Growth",
    description: "50% Savings, 50% Investment",
    icon: icon_slot(<TrendingUp className="icon-xl text-primary" />),
  },
  {
    value: "025-050-025",
    label: "Short-Term Stability",
    description: "25% Grant, 50% Savings, 25% Investment",
    icon: icon_slot(<Banknote className="icon-2xl text-primary" />),
  },
  {
    value: "075-025-000",
    label: "Immediate Impact",
    description: "75% Grant, 25% Savings",
    icon: icon_slot(<Zap className="icon-2xl text-warning" />),
  },
];
