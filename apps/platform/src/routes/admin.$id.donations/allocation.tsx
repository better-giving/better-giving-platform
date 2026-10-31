import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { CircleHelp, HandCoins, Pencil, PiggyBank, Sprout } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { IAllocation } from "@/donations";

interface Props {
  allocation: IAllocation;
  classes?: string;
  disabled?: boolean;
  exporter?: ReactNode;
}
export function Allocation(props: Props) {
  return (
    <div className={`grid gap-4 rounded ${props.classes ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h2>Distribution</h2>

        <NavLink
          title="Edit allocation settings"
          to="edit-alloc"
          replace
          preventScrollReset
          aria-disabled={props.disabled}
          className="link mr-auto disabled:text-gray-11 [.pending]:text-gray-11"
        >
          <Pencil className="icon-sm" />
        </NavLink>
        {props.exporter}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
        <Row
          icon={<HandCoins className="icon-md mr-2 text-gray-11" />}
          title={
            <div className="flex items-center">
              <span>Grants</span>
              <Tooltip
                tip={
                  <Content className="max-w-xs text-sm">
                    Donations received through Better Giving that will
                    distributed to your bank account.
                    <Arrow />
                  </Content>
                }
              >
                <CircleHelp className="text-gray-11 ml-1 icon-sm" />
              </Tooltip>
            </div>
          }
          pct={props.allocation.cash}
        />
        <Row
          icon={<PiggyBank className="icon-md mr-2 text-gray-11" />}
          title={<span>Savings</span>}
          pct={props.allocation.liq}
        />

        <Row
          icon={<Sprout className="icon-md mr-2 text-gray-11" />}
          title={<span>Investments</span>}
          pct={props.allocation.lock}
        />
      </div>
    </div>
  );
}

interface IRow {
  pct: number;
  icon: ReactNode;
  title: ReactNode;
}
function Row(props: IRow) {
  return (
    <div className="card flex items-center">
      {props.icon}
      {props.title}
      <span className="ml-12 text-gray-11 font-medium text-sm ">
        {props.pct ?? 50} %
      </span>
    </div>
  );
}
