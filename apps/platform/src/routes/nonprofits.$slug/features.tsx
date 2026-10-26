import {
  ChartNoAxesColumnIncreasingIcon,
  DollarSignIcon,
  Shield,
  TargetIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";

interface Item {
  title: string;
  description: string;
  result: string;
  icon: ReactNode;
}

export const items: Item[] = [
  {
    title: "One donation form. Every payment type.",
    description:
      "Accept cash, credit, stock, crypto, DAF donations. One simple form. No multiple platforms. No complexity.",
    result: "Result: Never lose a donor due to payment limitations.",
    icon: <TargetIcon className="text-primary-fg pictogram-sm" />,
  },
  {
    title: "Register online",
    description:
      "No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee.",
    result: "Add the donation form to your site after you register.",
    icon: <ZapIcon className="text-primary-fg pictogram-sm" />,
  },
  {
    title: "Bulletproof Security & Compliance",
    description:
      "Card data is handled by Stripe (PCI SAQ A). Savings are held in FDIC-insured accounts.",
    result: "Result: Sleep easy knowing everything's secure.",
    icon: <Shield className="text-primary-fg pictogram-sm" />,
  },
  {
    title: "Real-Time Dashboard. Zero Spreadsheets.",
    description:
      "See every donation, track growth, download reports instantly. No more manual tracking.",
    result: "Result: Financial clarity in seconds, not hours.",
    icon: (
      <ChartNoAxesColumnIncreasingIcon className="text-primary-fg pictogram-sm" />
    ),
  },
  {
    title: "Your Money, Your Control",
    description:
      "Choose savings or the Sustainability Fund. Savings withdrawals are paid out every 3 days, and Sustainability Fund withdrawals are reviewed before payout. Returns vary, and past performance isn't a guarantee.",
    result: "Result: Flexibility without sacrificing growth.",
    icon: <DollarSignIcon className="text-primary-fg pictogram-sm" />,
  },
];

export function Features({ classes = "" }: { classes?: string }) {
  return (
    <div className={`${classes} grid`}>
      <h2 className="text-center capitalize section-heading mb-6">
        How we simplify fundraising for you
      </h2>
      <div className="grid gap-y-16 justify-self-center mt-8">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex @max-3xl:flex-col gap-y-4 items-center gap-x-16 last:mb-0"
          >
            <div className="flex items-center justify-center p-4 rounded-full bg-primary/10 text-primary">
              {item.icon}
            </div>
            <div className="ml-4">
              <h4 className="text-2xl @max-3xl:text-center font-semibold">
                {item.title}
              </h4>
              <p className="mt-2 text-lg  @max-3xl:text-center">
                {item.description}
              </p>
              <p className="mt-1 italic font-semibold text-primary-fg  @max-3xl:text-center">
                {item.result}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
