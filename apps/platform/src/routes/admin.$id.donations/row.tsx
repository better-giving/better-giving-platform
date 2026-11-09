import { to_usd } from "@better-giving/ui/helpers";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { InfoIcon, TagIcon } from "lucide-react";
import { href, Link } from "react-router";
import { Money } from "#/components/money";
import { default_allocation } from "@/constants/common";
import { is_reversed } from "@/donations";
import { toPP } from "@/helpers/date";
import { rd2num } from "@/helpers/decimal";
import { AmountFlow } from "./amount-flow";
import { Fees } from "./fees";
import { type IRow, origin_text } from "./helpers";

export function Row(props: IRow) {
  const reversed = !!props.status && is_reversed(props.status);
  return (
    <>
      <td className="whitespace-nowrap">
        {props.date ? toPP(props.date) : <Missing />}
      </td>
      <td>
        {props.program_id ? (
          <Link
            className="link"
            to={href("/org/:org/program/:program_id", {
              org: props.recipient_id.toString(),
              program_id: props.program_id,
            })}
          >
            {props.program_name}
          </Link>
        ) : (
          <Missing />
        )}
      </td>
      <td>
        {props.donation_origin === "bg-widget" ? (
          <div>
            <span className="whitespace-nowrap">Donation form</span>
            <span className="text-xs mt-0.5 flex items-center gap-1 whitespace-nowrap">
              <TagIcon className="shrink-0 icon-xs" />
              {props.donation_origin_tag || props.donation_origin_id}
            </span>
          </div>
        ) : (
          origin_text(props.donation_origin)
        )}
      </td>
      <td>{props.payment_method ?? <Missing />}</td>
      <td className="num">
        <Money
          amount={+props.amount}
          currency={props.currency}
          amount_usd={+props.amount_usd}
        />
        <p className="text-xs first-letter:uppercase">{props.frequency}</p>
      </td>
      <td className="num">
        <Fees {...props.fees} />
      </td>
      <td className="num whitespace-nowrap">
        <span
          className={reversed ? "line-through text-destructive-subtle-fg" : ""}
        >
          {/* rounded down, as AmountFlow rounds each branch */}
          {to_usd(rd2num(props.net_usd), 2)}
        </span>
        {reversed && (
          <Tooltip
            tip={
              <Content className="max-w-xs text-xs">
                <Arrow />
                Refunded
              </Content>
            }
          >
            <InfoIcon className="inline ml-1 text-destructive icon-sm" />
          </Tooltip>
        )}
      </td>
      <td>
        <AmountFlow
          total={+props.net_usd}
          allocation={props.allocation ?? default_allocation}
          stripe_payout={props.stripe_payout}
        />
      </td>
      <td>
        <div>{props?.donor_name ?? <Missing />}</div>
        <div className="text-xs">{props.donor_email}</div>
        <p className="text-xs mt-0.5">
          {[
            props?.street,
            props?.city,
            props?.state,
            props?.zip_code,
            props?.country,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
        <p className="text-xs mt-0.5">{props.donor_company}</p>
      </td>
    </>
  );
}

function Missing() {
  return <span className="text-gray-11">—</span>;
}
