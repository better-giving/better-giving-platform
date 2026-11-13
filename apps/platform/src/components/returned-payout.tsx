import { PayoutStatus } from "@better-giving/ui";
import { Content, Tooltip } from "@better-giving/ui/tooltip";
import { CircleAlertIcon } from "lucide-react";
import type { IPayout } from "@/payouts";

const TIPS = {
  returned:
    "Your bank sent this back, and the money is in your balance. Update your bank details; it goes out again once the new ones are approved.",
  void: "Not counted as a grant.",
  grant:
    "Your bank sent this grant back, so it isn't counted in your grant totals. It goes out again once new bank details are approved.",
} as const;

const NAMES = {
  returned: "What Returned means",
  void: "What Void means",
  grant: "What this returned grant means",
} as const;

interface IStatusTip {
  kind: keyof typeof TIPS;
}

/** the (!) beside a status that needs explaining: opens on hover, focus and tap */
function StatusTip({ kind }: IStatusTip) {
  return (
    <Tooltip tip={<Content className="text-sm max-w-xs">{TIPS[kind]}</Content>}>
      <span className="inline-flex">
        <CircleAlertIcon className="text-gray-11 icon-sm" />
        <span className="sr-only">{NAMES[kind]}</span>
      </span>
    </Tooltip>
  );
}

interface IPayoutStatusCell {
  payout: IPayout;
}

/** a payout's status, with its explanation for returned and void; nothing extra for the rest */
export function PayoutStatusCell({ payout }: IPayoutStatusCell) {
  if (payout.type !== "returned" && payout.type !== "void") {
    return <PayoutStatus type={payout.type} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <PayoutStatus type={payout.type} />
      <StatusTip kind={payout.type} />
    </span>
  );
}

interface IReturnedGrant {
  amount: string;
}

/** a grant whose transfer the bank sent back: struck amount, status, and why on tap */
export function ReturnedGrant({ amount }: IReturnedGrant) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="line-through text-gray-11">{amount}</span>
      <PayoutStatus type="returned" />
      {/* the tooltip's own button is the flex item, so the offsets sit on this span */}
      <span className="inline-flex self-center -ml-1.5">
        <StatusTip kind="grant" />
      </span>
    </div>
  );
}

/** a payout row's arrow: muted for the two that aren't a grant paid out */
export const arrow_cls = (p: IPayout) =>
  p.type === "returned" || p.type === "void"
    ? "stroke-gray-11"
    : "stroke-success";

/** a payout row's amount: refunded and void are struck, each in its own ink */
export const amount_cls = (p: IPayout) =>
  p.type === "refunded"
    ? "line-through text-destructive-subtle-fg"
    : p.type === "void"
      ? "line-through text-gray-11"
      : "";
