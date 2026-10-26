import type {
  IFundItem,
  IFundItemsPage,
  IFundsNpoMemberOfSearchObj,
  IFundsSearchObj,
} from "@/campaign";
import { fund_npo_memberof, fund_search } from "$/pg/queries/fund";

export const get_funds = (params: IFundsSearchObj): Promise<IFundItemsPage> =>
  fund_search(params);

export const get_funds_npo_memberof = (
  endow_id: number,
  params: IFundsNpoMemberOfSearchObj
): Promise<IFundItem[]> => fund_npo_memberof(endow_id, params);
