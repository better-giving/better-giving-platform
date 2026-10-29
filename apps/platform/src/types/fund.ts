import type { IFundRow } from "$/pg/queries/fund";

export interface IFundMember {
  id: number;
  slug: string | undefined;
  name: string;
  logo: string | undefined;
  banner: string | undefined;
}
export interface IFund extends Omit<IFundRow, "members"> {
  members: IFundMember[];
}
