import {
  HandCoins,
  type LucideIcon,
  MoveRight,
  PiggyBankIcon,
  SproutIcon,
} from "lucide-react";
import type { IAllocation } from "@/donations";
import { humanize } from "@/helpers/decimal";

interface Props {
  total: number;
  font_size?: number; // font size in pixels, defaults to 18
  allocation: IAllocation;
}

interface Desc {
  Icon: LucideIcon;
  class: string;
  text: string;
}

type Acc = keyof IAllocation;

type DescMap = { [acc in Acc]: Desc };
const desc_map: DescMap = {
  cash: { Icon: HandCoins, class: "shrink-0 stroke-neutral", text: "Grant" },
  liq: {
    Icon: PiggyBankIcon,
    class: "shrink-0 stroke-neutral",
    text: "Savings",
  },
  lock: {
    Icon: SproutIcon,
    class: "shrink-0 stroke-neutral",
    text: "Investments",
  },
};

export function AmountFlow({ total, font_size = 14, allocation }: Props) {
  const branches = (Object.entries(allocation) as [Acc, number][])
    .filter(([, v]) => v > 0)
    .map(([k]) => ({
      ...desc_map[k],
      amount: total * (allocation[k] / 100),
    }));

  const icon_size = Math.max(16, font_size * 0.9); // icon size scales with font

  return (
    <div className="flex items-center gap-2">
      <MoveRight aria-hidden className="icon-md shrink-0" />

      <div className="flex flex-col gap-1">
        {branches.map((item, index) => (
          <div key={index} className="flex items-center gap-x-1">
            {/* icon */}
            <item.Icon className={item.class} size={icon_size} />
            {/* amount */}
            <div
              className="text-sm shrink-0"
              style={{ fontSize: `${font_size}px` }}
            >
              ${humanize(item.amount)}
            </div>
            {/* optional text */}
            {item.text && (
              <div
                className="text-gray-11 whitespace-nowrap"
                style={{ fontSize: `${Math.max(12, font_size * 0.75)}px` }}
              >
                - {item.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
