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
  stripe: "Stripe donations go straight to your Stripe account.",
};

export interface ICell {
  text: string;
  /** the money waits in the balance: the Held badge leads the text */
  held?: boolean;
}

export interface IRow {
  term: string;
  /** step 4's radio cards; absent on a row only the comparison carries */
  card?: Record<TPayoutOption, ICell>;
  /** the card's Stripe sentence once Stripe says the account is ready */
  card_stripe_ready?: string;
  /** Banking's side-by-side */
  compare: Record<TPayoutOption, ICell>;
}

const to_bank: ICell = { text: "To your bank." };
const held_others: ICell = {
  text: "Held in your Better Giving balance until you add a bank account.",
  held: true,
};
const held_withdrawals: ICell = {
  text: "Held until you add a bank account.",
  held: true,
};

/** what each option does with each kind of money */
export const rows: IRow[] = [
  {
    term: "Stripe donations",
    card: {
      bank: {
        text: "To your bank, after your Grant, Savings and Investments split.",
      },
      stripe: {
        text: "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. Until then they're held. They skip your split.",
      },
    },
    card_stripe_ready:
      "Straight to your Stripe account as each donation's own transfer, after fees. They skip your split.",
    compare: {
      bank: {
        text: "To your bank, every 3 days once your balance reaches your payout minimum, after your Grant, Savings and Investments split.",
      },
      stripe: {
        text: "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. They skip your split.",
      },
    },
  },
  {
    term: "PayPal, DAF grants, crypto, stocks, cheques",
    card: { bank: to_bank, stripe: held_others },
    compare: { bank: to_bank, stripe: held_others },
  },
  {
    term: "Savings and Investments withdrawals",
    card: { bank: to_bank, stripe: held_withdrawals },
    compare: { bank: to_bank, stripe: held_withdrawals },
  },
  {
    term: "Available to",
    compare: {
      bank: { text: "Every nonprofit." },
      stripe: { text: "Nonprofits Stripe is available to." },
    },
  },
];

/** a Stripe account counts as set up in any status Stripe holds it in, ready
 *  or not; a disconnected one no longer does */
export const is_linked = (s: TConnectStatus) =>
  s === "incomplete" || s === "pending" || s === "ready";

/** the bank payout line every surface states, the saved bank card excepted */
export const BANK_PAYOUT_LINE =
  "Bank payout: we send it to your bank account every 3 days once your balance reaches your payout minimum.";
