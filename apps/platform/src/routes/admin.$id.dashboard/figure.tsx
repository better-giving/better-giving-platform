import { HoverCard } from "@better-giving/ui/hover-card";
import { Tooltip } from "@better-giving/ui/tooltip";
import { ArrowRightIcon, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";

type Props = {
  title: string;
  /** e.g. $100,000 */
  amount: string;
  /** must be wrapped by tooltip content */
  tooltip?: ReactNode;
  /** when set, renders a HoverCard instead of tooltip */
  hover_content?: ReactNode;
  to: string;
};

export function Figure(props: Props) {
  const icon = <CircleHelp className="text-gray-11 ml-1 icon-sm" />;

  return (
    <div className="card @container">
      <div className="flex items-center mb-2">
        <h4 className="text-sm font-medium text-gray-11">{props.title}</h4>
        {props.hover_content ? (
          <HoverCard tip={props.hover_content}>{icon}</HoverCard>
        ) : (
          props.tooltip && <Tooltip tip={props.tooltip}>{icon}</Tooltip>
        )}

        <NavLink
          to={props.to}
          aria-label={`View ${props.title}`}
          className="ml-auto link active:translate-x-0.5"
        >
          <ArrowRightIcon className="icon-lg" />
        </NavLink>
      </div>
      <div className="figures text-3xl font-bold">{props.amount}</div>
    </div>
  );
}
