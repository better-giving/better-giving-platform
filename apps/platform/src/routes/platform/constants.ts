import {
  BanknoteIcon,
  BookOpenCheckIcon,
  Building2Icon,
  DollarSignIcon,
  HandCoinsIcon,
  HatGlassesIcon,
  LandmarkIcon,
  LineChartIcon,
  PiggyBankIcon,
  ReceiptIcon,
  TrendingDownIcon,
} from "lucide-react";
import type { LinkGroup } from "#/layout/dashboard";
import { routes } from "./routes";

const fund_management: LinkGroup = {
  title: "Fund Management",
  links: [
    {
      title: "Investments",
      to: routes.investments,
      icon: {
        fn: LineChartIcon,
      },
    },
    {
      title: "Redeem Requests",
      to: routes.redeem_requests,
      icon: {
        fn: BookOpenCheckIcon,
      },
    },
    {
      title: "Savings",
      to: routes.savings,
      icon: {
        fn: PiggyBankIcon,
      },
    },
  ],
};

export const link_groups: LinkGroup[] = [
  {
    links: [
      {
        title: "NPO Applications",
        to: routes.applications,
        icon: { fn: Building2Icon },
      },
      {
        title: "Banking Applications",
        to: routes.banking_applications,
        icon: { fn: LandmarkIcon },
      },
      {
        title: "Donations",
        to: routes.donations,
        icon: { fn: ReceiptIcon },
      },
      {
        title: "Settle Donations",
        to: routes.donation_settlements,
        icon: { fn: BanknoteIcon },
      },
      {
        title: "Revenue",
        to: routes.revenue,
        icon: { fn: DollarSignIcon },
      },
      {
        title: "Losses",
        to: routes.losses,
        icon: { fn: TrendingDownIcon },
      },
      {
        title: "Amounts owed",
        to: routes.owed,
        icon: { fn: HandCoinsIcon },
      },
      {
        title: "Campaign moderation",
        to: routes.campaign_moderation,
        icon: { fn: HatGlassesIcon },
      },
    ],
  },
  fund_management,
];

/** to reduce number of txs, skip tiny amounts */
export const MIN_INTR_TO_CREDIT = 0.01;
