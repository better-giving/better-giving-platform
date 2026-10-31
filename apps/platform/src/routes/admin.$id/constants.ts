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
      title: "Campaigns",
      to: sidebar_routes.campaigns,
      icon: {
        fn: MegaphoneIcon,
      },
      end: true,
    },
    {
      title: "Donation Forms",
      to: sidebar_routes.forms,
      icon: {
        fn: Blocks,
      },
    },
    {
      title: "Donors",
      to: sidebar_routes.donors,
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
  title: "Manage",
  links: [
    {
      title: "Organization",
      to: sidebar_routes.organization,
      icon: {
        fn: Building2,
      },
    },
    {
      title: "Programs",
      to: sidebar_routes.programs,
      icon: {
        fn: ListCheck,
      },
    },
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
        fn: HandshakeIcon,
      },
    },
  ],
};

export const linkGroups: LinkGroup[] = [group1, group2, group3];
