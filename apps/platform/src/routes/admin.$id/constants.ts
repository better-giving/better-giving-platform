import {
  Blocks,
  BoxIcon,
  Building2,
  CircleDollarSign,
  HandshakeIcon,
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
import { routes } from "#/pages/admin/routes";

const { program_editor: _pe, ...sidebar_routes } = routes;

const group1: LinkGroup = {
  links: [
    {
      title: "Dashboard",
      to: sidebar_routes.dashboard,
      icon: {
        fn: LayoutDashboard,
        size: 20,
      },
      end: true,
    },
    {
      title: "Donations",
      to: sidebar_routes.donations,
      icon: {
        fn: CircleDollarSign,
        size: 22,
      },
    },
    {
      title: "Campaigns",
      to: sidebar_routes.campaigns,
      icon: {
        fn: MegaphoneIcon,
        size: 22,
      },
      end: true,
    },
    {
      title: "Donation Forms",
      to: sidebar_routes.forms,
      icon: {
        fn: Blocks,
        size: 25,
      },
    },
    {
      title: "Donors",
      to: sidebar_routes.donors,
      icon: {
        fn: Heart,
        size: 21,
      },
    },
    {
      title: "Assets",
      to: sidebar_routes.assets,
      icon: {
        fn: BoxIcon,
        size: 20,
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
        size: 22,
      },
    },
    {
      title: "Investments",
      to: sidebar_routes.investments,
      icon: {
        fn: SproutIcon,
        size: 22,
      },
    },
  ],
};

const group3: LinkGroup = {
  title: "Manage",
  links: [
    {
      title: "Organization",
      to: sidebar_routes.organization,
      icon: {
        fn: Building2,
        size: 21,
      },
    },
    {
      title: "Programs",
      to: sidebar_routes.programs,
      icon: {
        fn: ListCheck,
        size: 22,
      },
    },
    {
      title: "Settings",
      to: "settings",
      icon: {
        fn: Settings,
        size: 21,
      },
    },
    {
      title: "Members",
      to: "members",
      icon: {
        fn: UsersRound,
        size: 21,
      },
    },
    {
      title: "Banking",
      to: sidebar_routes.banking,
      icon: {
        fn: Wallet,
        size: 20,
      },
    },
    {
      title: "Integrations",
      to: sidebar_routes.integrations,
      icon: {
        fn: PlugZap,
        size: 23,
      },
    },
    {
      title: "Referrals",
      to: sidebar_routes.referrals,
      icon: {
        fn: HandshakeIcon,
        size: 22,
      },
    },
  ],
};

export const linkGroups: LinkGroup[] = [group1, group2, group3];
