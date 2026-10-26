import { Target, to_target } from "@better-giving/ui";
import { href, Link } from "react-router";
import { FundStatusBadge, status_fn } from "#/components/campaign";
import type { IFundRow } from "$/pg/queries/fund";

export const Fund = (props: IFundRow) => {
  const status = status_fn(
    props.expiration ?? undefined,
    props.active,
    props.donation_total_usd
  );
  return (
    <div className="grid grid-rows-subgrid row-span-4 content-start gap-y-0 items-center border p-3 rounded">
      <div className="flex items-start justify-between">
        <img
          src={props.logo}
          width={50}
          className="object-cover aspect-square rounded-full"
          alt=""
        />

        <FundStatusBadge status={status} />
      </div>

      <Link
        to={href("/campaigns/:fund_id", { fund_id: props.id })}
        className="mt-4 font-semibold link"
      >
        {props.name}
      </Link>

      <Target
        classes="mt-4"
        progress={props.donation_total_usd}
        target={props.target ? to_target(props.target) : null}
      />

      <Link
        aria-disabled={!status.active}
        className="btn btn-primary justify-self-end mt-6"
        to={href("/campaigns/:fund_id/edit", { fund_id: props.id })}
      >
        Edit
      </Link>
    </div>
  );
};
