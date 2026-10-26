import type { DonateMethodId } from "../schemas";
import type { IPageNumbered } from "../types/api";
import type { IFundNew } from "./schema";

export interface IFundCreator {
  /** user uuid */
  creator_id: string;
}

export interface IFundInternal extends IFundCreator {
  /** uuid */
  id: string;
  spam_score?: number;
  created_at: string;
  /** fund can be closed before expiration  */
  active: boolean;
  /** to date received: initialized to `0` */
  donation_total_usd: number;
  hide_bg_tip: boolean;
  fund_donate_methods?: DonateMethodId[];
}

export interface IFund extends IFundNew, IFundInternal {}

/** search doc record */
export interface IFundItem
  extends Pick<
      IFundNew,
      | "name"
      | "description_pt"
      | "logo"
      | "banner"
      | "published"
      | "target"
      | "npo_owner"
    >,
    Pick<IFundInternal, "id" | "active" | "donation_total_usd" | "creator_id"> {
  creator_name: string;
  /** Unix timestamp @default - 253402300799 */
  expiration: number;
}

export interface IFundItemsPage extends IPageNumbered<IFundItem> {}
export interface IFundsPageOpts {
  limit?: number;
  next?: string;
}
