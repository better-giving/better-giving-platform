import { ClockIcon, TrendingUpIcon, WalletIcon } from "lucide-react";
import type { ReactElement } from "react";

interface ICard {
  title: string;
  description: string;
  icon: ReactElement;
}
export const cards: ICard[] = [
  {
    icon: (
      <WalletIcon className="stroke-primary-fg bg-primary p-2 rounded-full size-10" />
    ),
    title: "Every giving method",
    description:
      "Cards,   crypto, bank transfers, and DAFs in one place. Accept donations however donors prefer.",
  },
  {
    icon: (
      <TrendingUpIcon className="stroke-primary-fg bg-primary p-2 rounded-full size-10" />
    ),
    title: "Earning wallets",
    description:
      "Savings that grow all year long. Watch your donations compound over time.",
  },
  {
    icon: (
      <ClockIcon className="stroke-primary-fg bg-primary p-2 rounded-full size-10" />
    ),
    title: "Year-round support",
    description:
      "Not just for one day. Our team and features are here every day of the year.",
  },
];

export function Features({ classes = "" }) {
  return (
    <div className={`${classes} grid py-10`}>
      <h2 className="text-center section-heading">
        Our features aren't seasonal. They're standard.
      </h2>
      <p className="section-body mt-4 mb-10 text-center">
        Everything you need to grow your mission, available every single day.
      </p>
      <div className="grid gap-4 mt-10 xl:grid-cols-3 xl:grid-rows-[auto_auto_1fr]">
        {cards.map(({ title, description, icon }) => (
          <div
            key={title}
            className="card grid grid-rows-subgrid justify-items-center row-span-3 items-center"
          >
            <div className="p-1">{icon}</div>
            <div className="text-xl font-semibold">{title}</div>
            <p className="text-center">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
