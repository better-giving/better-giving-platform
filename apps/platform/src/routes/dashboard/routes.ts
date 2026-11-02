import {
  BlocksIcon,
  CircleDollarSign,
  CircleUserRound,
  Heart,
  HomeIcon,
  MegaphoneIcon,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { LinkGroup } from "#/layout/dashboard";

export const routes = {
  index: "",
  edit_profile: "edit-profile",
  donations: "donations",
  funds: "funds",
  settings: "settings",
  referrals: "referrals",
  subscriptions: "subscriptions",
  forms: "forms",
};

export const linkGroups: LinkGroup[] = [
  {
    links: [
      {
        title: "Home",
        to: routes.index,
        // exact match so subroutes don't keep Home highlighted
        end: true,
        icon: {
          fn: HomeIcon,
        },
      },
      {
        title: "My donations",
        to: routes.donations,
        icon: {
          fn: CircleDollarSign,
        },
      },
      {
        title: "Recurring donations",
        to: routes.subscriptions,
        icon: {
          fn: RefreshCw,
        },
      },
      {
        title: "Edit profile",
        to: routes.edit_profile,
        icon: {
          fn: CircleUserRound,
        },
      },
      {
        title: "Settings",
        to: routes.settings,
        icon: {
          fn: Settings,
        },
      },
      {
        title: "My campaigns",
        to: routes.funds,
        icon: {
          fn: Heart,
        },
      },
      {
        title: "My referrals",
        to: routes.referrals,
        icon: {
          fn: MegaphoneIcon,
        },
      },
      {
        title: "My donation forms",
        to: routes.forms,
        icon: {
          fn: BlocksIcon,
        },
      },
    ],
  },
];
