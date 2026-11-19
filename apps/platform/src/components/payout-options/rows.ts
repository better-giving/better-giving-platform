import type { TConnectStatus } from "@/stripe-connect/readiness";

/** the two ways a nonprofit can get paid; having both is possible */
export type TPayoutOption = "bank" | "stripe";

export const options: TPayoutOption[] = ["bank", "stripe"];

export const option_names: Record<TPayoutOption, string> = {
  bank: "Bank",
  stripe: "Stripe",
};

/** the line under an option's name, open or collapsed */
export const option_summaries: Record<TPayoutOption, string> = {
  bank: "One payout for everything.",
  stripe:
    "Card, bank and wallet donations go straight to your Stripe account once it's ready.",
};

/** the Bank summary once Stripe says the linked account is ready */
export const BANK_SUMMARY_WITH_STRIPE =
  "One payout for everything your Stripe account doesn't receive.";

/** the Stripe summary once Stripe says the linked account is ready */
export const STRIPE_SUMMARY_READY =
  "Card, bank and wallet donations go straight to your Stripe account.";

export interface ICell {
  text: string;
  /** the money waits in the balance: the Held badge leads the text, so the
   *  text never opens on "Held" itself */
  held?: boolean;
}

export interface IRow {
  term: string;
  /** `stripe_with_bank` is the Stripe card's cell while a bank is on file */
  card: Record<TPayoutOption | "stripe_with_bank", ICell>;
  /** the card's Stripe sentence once Stripe says the account is ready, bank
   *  or not */
  card_stripe_ready?: string;
  /** the Bank card's cell while a Stripe account is linked, before and once
   *  Stripe says it's ready. rows Stripe never receives keep `card.bank` */
  bank_with_stripe?: { linked: ICell; ready: ICell };
}

const to_bank: ICell = { text: "To your bank." };
/** Stripe with no bank on file. no Held badge: holding is only the
 *  until-ready tail, and the badge would lead the whole outcome */
const stripe_without_bank: ICell = {
  text: "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. They skip your split. Until then they're held.",
};
const held_others: ICell = {
  text: "In your Better Giving balance until you add a bank account.",
  held: true,
};
const held_withdrawals: ICell = {
  text: "They stay in your balance until you add a bank account.",
  held: true,
};

/** what each option does with each kind of money */
export const rows: IRow[] = [
  {
    term: "Card, bank and wallet donations",
    card: {
      bank: {
        text: "To your bank, after your Grant, Savings and Investments split.",
      },
      stripe: stripe_without_bank,
      stripe_with_bank: {
        text: "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. They skip your split. Until then, they go to your bank.",
      },
    },
    card_stripe_ready:
      "Straight to your Stripe account as each donation's own transfer, after fees. They skip your split.",
    bank_with_stripe: {
      linked: {
        text: "To your bank, after your Grant, Savings and Investments split, until Stripe says your account is ready. Then they go straight to your Stripe account instead.",
      },
      ready: {
        text: "To your Stripe account, not your bank. If you disconnect Better Giving in your Stripe dashboard, they go to your bank instead.",
      },
    },
  },
  {
    term: "PayPal, DAF grants, crypto, stocks, cheques",
    card: { bank: to_bank, stripe: held_others, stripe_with_bank: to_bank },
  },
  {
    term: "Savings and Investments withdrawals",
    card: {
      bank: to_bank,
      stripe: held_withdrawals,
      stripe_with_bank: to_bank,
    },
  },
];

/** a Stripe account counts as set up in any status Stripe holds it in, ready
 *  or not; a disconnected one no longer does */
export const is_linked = (s: TConnectStatus) =>
  s === "incomplete" || s === "pending" || s === "ready";

/** the bank payout sentence under a "Bank payout" heading, which already names it */
export const BANK_PAYOUT_SENTENCE =
  "We send it to your bank account every 3 days once your balance reaches your payout minimum.";

/** the same line where no such heading sits above it (step 4's footnote) */
export const BANK_PAYOUT_LINE = `Bank payout: ${BANK_PAYOUT_SENTENCE.replace(/^W/, "w")}`;

/** the bank payout sentence where no heading names the bank payout, as under
 *  a "Payouts" heading */
export const BANK_PAYOUT_LEAD =
  "We send a payout to your bank account every 3 days once your balance reaches your payout minimum.";
