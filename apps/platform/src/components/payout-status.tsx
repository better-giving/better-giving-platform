import { PayoutStatus as SystemPayoutStatus } from "@better-giving/ui";
import type { PayoutStatus as TPayoutStatus } from "@/payouts";

interface IPayoutStatus {
  type: TPayoutStatus["type"];
  classes?: string;
}

// TODO(registry): `returned` and `void` are drawn here until the design
// registry's PayoutStatus carries them; then this file goes and the call
// sites import the system's again
export function PayoutStatus({ type, classes = "" }: IPayoutStatus) {
  if (type === "returned") {
    return (
      <span
        className={`${classes} inline-flex items-center gap-2 text-xs font-medium text-warning-subtle-fg`}
      >
        <span className="w-2 h-2 rounded-full bg-warning" />
        Returned
      </span>
    );
  }
  if (type === "void") {
    return (
      <span
        className={`${classes} inline-flex items-center gap-2 text-xs font-medium text-gray-11`}
      >
        <span className="w-2 h-2 rounded-full border-[1.5px] border-gray-11" />
        Void
      </span>
    );
  }
  return <SystemPayoutStatus type={type} classes={classes} />;
}
