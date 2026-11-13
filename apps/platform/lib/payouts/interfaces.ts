export interface IErrorStatus {
  type: "error";
  message: string;
}

export interface ISettledStatus {
  type: "settled";
  settled_date: string;
  settled_id: string;
}
export interface IPendingStatus {
  type: "pending";
}
/** claimed by the grants cron: its wise transfer is in flight or unreconciled */
export interface IProcessingStatus {
  type: "processing";
  /** the claim's wise `customerTransactionId`; `""` on a claim made before it was stored */
  ref: string;
}
export interface IRefundedStatus {
  type: "refunded";
}

/** refunded but platform absorbed the loss — NPO kept funds */
export interface IRefundedLossStatus {
  type: "refunded_loss";
}

/** manually cancelled */
export interface ICancelledStatus {
  type: "cancelled";
}

/** the bank sent the wise transfer back: the money is in the npo's balance, and goes out again once a newer approved account is the one the grants run pays (`npo_return_hold`) */
export interface IReturnedStatus {
  type: "returned";
}

/** voided by ops: not a grant, not counted */
export interface IVoidStatus {
  type: "void";
}

export type PayoutStatus =
  | IErrorStatus
  | ISettledStatus
  | IPendingStatus
  | IProcessingStatus
  | IRefundedStatus
  | IRefundedLossStatus
  | ICancelledStatus
  | IReturnedStatus
  | IVoidStatus;

/** the types whose money is in the npo's cash, not sent: a refund cancels the
 * payout and takes its cash back */
export const UNSENT_TYPES = [
  "pending",
  "returned",
] as const satisfies readonly PayoutStatus["type"][];

export const is_unsent = (type: string | null | undefined): boolean =>
  UNSENT_TYPES.some((t) => t === type);

/**
 * donation - a payout from a donation
 * liq - withdraw from savings
 * lock - withdraw from investments
 */
export type TSource = "donation" | "liq" | "lock";

export type IPayout<T extends PayoutStatus = PayoutStatus> = {
  id: string;
  source_id: string;
  npo_id: number;
  source: TSource;
  /** date created */
  date: string;
  amount: number;
} & T;

export interface INpoPayoutsOptions {
  next?: string;
  status?: PayoutStatus["type"];
  /** left out of the page, so the page fills with the rest */
  not_status?: PayoutStatus["type"];
  limit?: number;
}

/**
 * the rail a pending payout's money came in by. `stripe` is a stripe gift
 * settled into the balance rather than routed to the connected account;
 * `stock_cheque` is every gift a platform admin records by hand (stocks,
 * cheques, cash, employer matches); `withdrawal` is a Savings or Investments
 * withdrawal.
 */
export type HeldRail =
  | "stripe"
  | "paypal"
  | "daf"
  | "crypto"
  | "stock_cheque"
  | "withdrawal";

/** usd an npo is owed by pending payouts, which only a bank payout can pay */
export interface IHeldMoney {
  total: number;
  /** what the payout run would pay of `total` after the amounts the npo owes
   * Better Giving, plus what Better Giving owes it back: `total` when nothing
   * is owed, above `total` when only Better Giving owes. absent: owed netting
   * is off, or nothing is held */
  net?: number;
  /** rails with nothing pending are left out */
  by_rail: { rail: HeldRail; amount: number }[];
  /** one per pending payout, newest first */
  items: { rail: HeldRail; date: string; amount: number }[];
}

export interface INpoSettlementsOptions {
  next?: string;
  limit?: number;
}
export interface ISettlement {
  /** transfer id */
  id: string;
  other_id: string;
  /** npo id */
  npo_id: number;
  date: string;
  amount: number;
  sources: string[];
  /** https://docs.wise.com/api-docs/api-reference/transfer */
  status: string;
}
