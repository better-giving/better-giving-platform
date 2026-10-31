import {
  Blocks,
  BoxIcon,
  CircleDollarSign,
  Heart,
  LayoutDashboard,
  ListCheck,
  MegaphoneIcon,
  PiggyBankIcon,
  PlugZap,
  Settings,
  SproutIcon,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { LinkGroup } from "#/layout/dashboard";
import { routes } from "./routes";

const { program_editor: _pe, ...sidebar_routes } = routes;

const group1: LinkGroup = {
  links: [
    {
      title: "Dashboard",
      to: sidebar_routes.dashboard,
      icon: {
        fn: LayoutDashboard,
      },
      end: true,
    },
    {
      title: "Donations",
      to: sidebar_routes.donations,
      icon: {
        fn: CircleDollarSign,
      },
    },
    {
      title: "Donation forms",
      to: sidebar_routes.forms,
      icon: {
        fn: Blocks,
      },
    },
    {
      title: "Campaign opt-outs",
      to: sidebar_routes.funds,
      icon: {
        fn: Heart,
      },
    },
    {
      title: "Assets",
      to: sidebar_routes.assets,
      icon: {
        fn: BoxIcon,
      },
    },
  ],
};

const group2: LinkGroup = {
  title: "Fund Management",
  links: [
    {
      title: "Savings",
      to: sidebar_routes.savings,
      icon: {
        fn: PiggyBankIcon,
      },
    },
    {
      title: "Investments",
      to: sidebar_routes.investments,
      icon: {
        fn: SproutIcon,
      },
    },
  ],
};

const group3: LinkGroup = {
  title: "Public Profile",
  links: [
    {
      title: "Programs",
      to: sidebar_routes.programs,
      icon: {
        fn: ListCheck,
      },
    },
  ],
};

const group4: LinkGroup = {
  title: "Manage",
  links: [
    {
      title: "Settings",
      to: "settings",
      icon: {
        fn: Settings,
      },
    },
    {
      title: "Members",
      to: "members",
      icon: {
        fn: UsersRound,
      },
    },
    {
      title: "Banking",
      to: sidebar_routes.banking,
      icon: {
        fn: Wallet,
      },
    },
    {
      title: "Integrations",
      to: sidebar_routes.integrations,
      icon: {
        fn: PlugZap,
      },
    },
    {
      title: "Referrals",
      to: sidebar_routes.referrals,
      icon: {
        fn: MegaphoneIcon,
      },
    },
  ],
};

export const linkGroups: LinkGroup[] = [group1, group2, group3, group4];
