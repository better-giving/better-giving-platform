import laira_happy_jump from "#/assets/laira/laira-happy-jump.webp";
import laira_open_arms from "#/assets/laira/laira-open-arms.webp";
import laira_sitting from "#/assets/laira/laira-sitting.webp";
import laira_standing from "#/assets/laira/laira-standing.webp";
import icon1 from "./icons/Icon1_wb.webp";
import icon2 from "./icons/Icon2_wb.webp";
import icon3 from "./icons/Icon3_wb.webp";
import icon4 from "./icons/Icon4_wb.webp";
import icon5 from "./icons/Icon5_wb.webp";
import icon7 from "./icons/Icon7_wb.webp";
import { sf } from "./sf-benefits";
import type { Benefit } from "./types";

const colors = ["bg-mint", "bg-lilac", "bg-cream", "bg-sky"];

const donors: Benefit[] = [
  {
    title: "Sustainable Impact",
    description:
      "Your donation grows through our nonprofit Sustainability Fund. Give the gift that keeps on giving.",
    img: icon1,
    cardBgClass: colors[0],
    listIcon: { src: laira_open_arms, width: 28 },
  },
  {
    title: "The World At Your Fingertips",
    description:
      "Donate to any nonprofit, anywhere in the world. Support local grassroots organizations who understand the problems on the ground",
    img: icon2,
    cardBgClass: colors[1],
    listIcon: { src: laira_sitting, width: 23 },
  },
  {
    title: "Receive and Track Tax Benefits",
    description:
      "Get automated receipts to claim deductions and eliminate capital gains tax when donating property such as stocks and crypto",
    img: icon3,
    cardBgClass: colors[2],
    listIcon: { src: laira_happy_jump, width: 30 },
  },
  {
    title: "Your Donation, Your Way",
    description:
      "Use the giving method that works for you - from check, card and bank transfers to stock, DAF and crypto",
    img: icon4,
    cardBgClass: colors[3],
    listIcon: { src: laira_standing, width: 20 },
  },
];
const nonprofits: Benefit[] = [
  {
    title: "Free Donation Processing",
    title2: "More for your mission",
    description:
      "There is no platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee. Although third-party processing fees may apply, most donors choose to cover these fees. We handle the tax receipts and admin work for accepting all types of donations. Grants and savings withdrawals are paid out every 3 days once your balance reaches your payout minimum.",
    img: icon7,
    cardBgClass: colors[0],
  },
  {
    title: "High-Yield Savings Accounts",
    title2: "Secure, steady growth for your funds",
    description:
      "Choose to grow donations in a high-yield savings account. Returns vary, and past performance isn't a guarantee. Savings withdrawals are paid out every 3 days once your balance reaches your payout minimum. Sustainability Fund withdrawals are reviewed before payout.",
    img: icon5,
    cardBgClass: colors[1],
  },
  {
    title: "Managed Investment Funds",
    title2: "Maximize long-term financial growth",
    description:
      "Managed investment funds can hold a share of donations for longer-term growth. Returns vary, and past performance isn't a guarantee.",
    img: icon2,
    cardBgClass: colors[2],
  },
  {
    title: "Global Fiscal Sponsorship",
    title2: "Access U.S. grants and streamline international giving",
    description:
      "Our fiscal sponsorship program helps nonprofits outside the U.S. access tax-deductible donations from US donors and simplifies cross-border donations. Expand your reach and grow your donor base without navigating complex legal and tax processes on your own.",
    img: icon4,
    cardBgClass: colors[3],
  },
];

const donorsOrder2 = [donors[3], donors[0], donors[1], donors[2]];

export const benefits = { donors, nonprofits, sf, donorsOrder2 };
export type { Benefit } from "./types";
