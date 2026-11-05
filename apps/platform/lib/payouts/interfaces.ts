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

export type PayoutStatus =
  | IErrorStatus
  | ISettledStatus
  | IPendingStatus
  | IProcessingStatus
  | IRefundedStatus
  | IRefundedLossStatus
  | ICancelledStatus;

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
