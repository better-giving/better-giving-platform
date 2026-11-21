export interface IWirePayout {
  /** the payout's id */
  id: string;
  /** who the payout is for: the donor's email, else name ("Unknown donor"
   * when the gift has neither on record); "Savings" or "Investments" for a
   * withdrawal */
  label: string;
  /** iso; when the payout was created */
  date: string;
  amount: number;
}

/** a nonprofit paid by manual wire with payouts pending */
export interface IManualWireRow {
  npo_id: number;
  name: string;
  /** the pending payouts' total, to the cent */
  gross: number;
  /** gross − net: positive is deducted for what the npo owes, zero or negative when nothing is owed */
  owed: number;
  /** what the wire must carry before its fee */
  net: number;
  /** the npo's own payout minimum, else the platform's */
  minimum: number;
  /** the default bank account's summary, or "No bank account on file" */
  bank: string;
  /** oldest first */
  payouts: IWirePayout[];
}
