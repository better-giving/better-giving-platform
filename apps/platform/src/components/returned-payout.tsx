import { PayoutStatus } from "@better-giving/ui";
import { Content, Tooltip } from "@better-giving/ui/tooltip";
import { CircleAlertIcon } from "lucide-react";
import type { IPayout } from "@/payouts";
import { CHARGED_BACK, grant_state } from "@/payouts/wise-path";

const TIPS = {
  bounced_charged:
    "This payout was reversed after it was sent, and it hasn't come back to your balance. We're sorting it out by hand, so you don't need to chase it.",
  grant_bounced_charged:
    "This grant was reversed after it was sent, so it isn't counted in your grant totals, and it hasn't come back to your balance. We're sorting it out by hand.",
  sending:
    "This payout is on its way to your bank. It counts as Settled once it has been sent. Nothing is needed from you.",
  bounced:
    "Your bank didn't accept this payout, and the money is on its way back to your balance. Check that your bank details are right and update them if not. It goes out again once the new ones are approved.",
  grant_sending:
    "On its way to your bank, so not counted in your grant totals yet. It counts once it has been sent.",
  grant_bounced:
    "Your bank didn't accept this grant, so it isn't counted in your grant totals. The money is on its way back to your balance. Check your bank details.",
  returned:
    "Your bank sent this back, and the money is in your balance. Update your bank details; it goes out again once the new ones are approved.",
  void: "Not counted as a grant.",
  grant:
    "Your bank sent this grant back, so it isn't counted in your grant totals. It goes out again once new bank details are approved.",
} as const;

const NAMES = {
  bounced_charged: "What this reversed payout means",
  grant_bounced_charged: "What this reversed grant means",
  sending: "What Sending means",
  bounced: "What Bounced means",
  grant_sending: "What this sending grant means",
  grant_bounced: "What this bounced grant means",
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

/** a payout's status, with its explanation for the ones that need it; nothing extra for the rest */
export function PayoutStatusCell({ payout }: IPayoutStatusCell) {
  const kind =
    payout.type === "processing"
      ? "sending"
      : payout.type === "returned" ||
          payout.type === "void" ||
          payout.type === "bounced"
        ? payout.type === "bounced" && payout.charged_back
          ? "bounced_charged"
          : payout.type
        : null;
  if (!kind) return <PayoutStatus type={payout.type} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <PayoutStatus type={payout.type} />
      <StatusTip kind={kind} />
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

interface IUncountedGrant {
  amount: string;
}

/** a grant whose transfer wise has not yet reported sent: not in the totals, and says so */
export function SendingGrant({ amount }: IUncountedGrant) {
  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-gray-11">{amount}</span>
        <PayoutStatus type="processing" />
        <span className="inline-flex self-center -ml-1.5">
          <StatusTip kind="grant_sending" />
        </span>
      </div>
      <p className="text-sm text-gray-11">Not counted yet</p>
    </div>
  );
}

/** a grant whose transfer wise reports bounced: struck amount, status, and why on tap */
export function BouncedGrant({
  amount,
  charged_back = false,
}: IUncountedGrant & { charged_back?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="line-through text-gray-11">{amount}</span>
        <PayoutStatus type="bounced" />
        <span className="inline-flex self-center -ml-1.5">
          <StatusTip
            kind={charged_back ? "grant_bounced_charged" : "grant_bounced"}
          />
        </span>
      </div>
      <p className="text-sm text-gray-11">Not counted</p>
    </div>
  );
}

interface IGrantAmount {
  /** the grant's transfer: its stored wise state decides what it counts as */
  grant: { status: string; other_id: string | null; bounced?: boolean };
  amount: string;
}

/** a grant's amount as its transfer stands: plain once delivered, with the
 * Sending, Bounced or Returned treatment until then */
export function GrantAmount({ grant, amount }: IGrantAmount) {
  switch (grant_state(grant)) {
    case "returned":
      return <ReturnedGrant amount={amount} />;
    case "sending":
      return <SendingGrant amount={amount} />;
    case "bounced":
      return (
        <BouncedGrant
          amount={amount}
          charged_back={grant.status === CHARGED_BACK}
        />
      );
    default:
      return amount;
  }
}

/** a payout row's arrow: muted for the ones that aren't a grant paid out */
export const arrow_cls = (p: IPayout) =>
  p.type === "returned" ||
  p.type === "void" ||
  p.type === "processing" ||
  p.type === "bounced"
    ? "stroke-gray-11"
    : "stroke-success";

/** a payout row's amount: refunded and void are struck, each in its own ink */
export const amount_cls = (p: IPayout) =>
  p.type === "refunded"
    ? "line-through text-destructive-subtle-fg"
    : p.type === "void"
      ? "line-through text-gray-11"
      : "";
