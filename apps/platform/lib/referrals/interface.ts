export type TStatus =
  | "pending"
  | "processing"
  | "paid"
  | "returned"
  | "refunded"
  | "refunded_loss";

export interface ICommission {
  /** iso timestamp */
  date: string;
  referrer_user?: string;
  referrer_npo?: string;
  donation_id: string;
  /** nonprofit id */
  npo_id: number;
  /** combined from various sources */
  amount: number;
  status: TStatus;
  /** wise customerTransactionId, set while processing and kept once paid */
  ref?: string;
}
/** referrer lifetime data — per-npo commission aggregates */
export interface ICommissionsLtd {
  referrer: string;
  /** number only, string is to just conform with referrer */
  [npo: string]: string | number;
}

export interface IPayout {
  /** a paid row's wise `customerTransactionId` (its claim's ref), or the ref
   * of a run recovered as owed; a random uuid on an error row */
  id: string;
  date: string;
  amount: number;
  referrer_user?: string;
  referrer_npo?: string;
  // error or transfer_id; neither on a $0 row recovered as owed
  error?: string;
  transfer_id?: number;
  /** the wise recipient the transfer paid */
  recipient_id?: string;
}

export interface IPayoutLtd {
  referrer: string;
  amount: number;
}
