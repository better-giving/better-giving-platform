import { EmptyState } from "@better-giving/ui";
import type { IFundItem } from "@/campaign";
import { FundItem } from "./fund-item";

interface IFundsList {
  funds: IFundItem[];
  endow_id: number;
  platform_admin: boolean;
}

export function FundsList({ funds, endow_id, platform_admin }: IFundsList) {
  return (
    <>
      <p className="text-sm text-gray-11">
        These are campaigns people started for your nonprofit. You can leave any
        you don't want to receive from.
      </p>
      {funds.length === 0 ? (
        <EmptyState classes="mt-4" heading="No supporter campaigns yet">
          Campaigns people start for your nonprofit will show up here.
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {funds.map((fund) => (
            <FundItem
              key={fund.id}
              {...fund}
              isEditor={platform_admin || fund.npo_owner === endow_id}
              isSelf={fund.npo_owner === endow_id}
            />
          ))}
        </ul>
      )}
    </>
  );
}
