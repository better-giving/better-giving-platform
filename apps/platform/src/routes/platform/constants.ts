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
        size: 18,
      },
    },
    {
      title: "Redeem Requests",
      to: routes.redeem_requests,
      icon: {
        fn: BookOpenCheckIcon,
        size: 18,
      },
    },
    {
      title: "Savings",
      to: routes.savings,
      icon: {
        fn: PiggyBankIcon,
        size: 20,
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
        icon: { fn: Building2Icon, size: 18 },
      },
      {
        title: "Banking Applications",
        to: routes.banking_applications,
        icon: { fn: LandmarkIcon, size: 18 },
      },
      {
        title: "Donations",
        to: routes.donations,
        icon: { fn: ReceiptIcon, size: 18 },
      },
      {
        title: "Settle Donations",
        to: routes.donation_settlements,
        icon: { fn: BanknoteIcon, size: 18 },
      },
      {
        title: "Revenue",
        to: routes.revenue,
        icon: { fn: DollarSignIcon, size: 18 },
      },
      {
        title: "Losses",
        to: routes.losses,
        icon: { fn: TrendingDownIcon, size: 18 },
      },
      {
        title: "Amounts owed",
        to: routes.owed,
        icon: { fn: HandCoinsIcon, size: 18 },
      },
      {
        title: "Campaign moderation",
        to: routes.campaign_moderation,
        icon: { fn: HatGlassesIcon, size: 18 },
      },
    ],
  },
  fund_management,
];

/** to reduce number of txs, skip tiny amounts */
export const MIN_INTR_TO_CREDIT = 0.01;
