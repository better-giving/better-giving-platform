import { Image, Target, type TTarget, to_target } from "@better-giving/ui";
import { href, Link } from "react-router";
import { to_text } from "#/components/rich-text";

type Props = {
  id: string;
  progress: number;
  target: TTarget;
  name: string;
  logo: string;
  tagline?: string;
  classes?: string;
};
export function FundCard({ classes = "", ...props }: Props) {
  return (
    <div
      className={`md:card max-md:p-4 grid @xl/fund-card:grid-cols-[3fr_2fr] gap-x-4 gap-y-6 ${classes}`}
    >
      <div className="grid grid-cols-[auto-1fr] gap-x-4 justify-start order-2 @xl/fund-card:order-1">
        <Image
          src={props.logo}
          className="size-14 border rounded object-cover bg-panel row-span-2"
        />
        <Link
          to={href("/campaigns/:fund_id", { fund_id: props.id })}
          className="link text-ellipsis overflow-hidden text-nowrap @xl/fund-card:text-balance col-start-2 w-full"
        >
          {props.name}
        </Link>
        {props.tagline && (
          <p className="text-gray-11 text-sm w-full line-clamp-2">
            {to_text(props.tagline)}
          </p>
        )}
      </div>
      <Target
        text={<Target.Text classes="mb-2" />}
        progress={props.progress}
        target={to_target(props.target)}
        classes="order-1 @xl/fund-card:order-2"
      />
    </div>
  );
}
