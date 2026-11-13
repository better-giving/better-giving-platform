import { PayoutStatus } from "@better-giving/ui";
import { href, Link } from "react-router";
import type { IPayout } from "@/payouts";

interface IPayoutNote {
  payout: IPayout;
}

/** the explanation row under a returned or void payout; nothing for the rest */
export function PayoutNote({ payout }: IPayoutNote) {
  if (payout.type !== "returned" && payout.type !== "void") return null;
  return (
    <tr>
      <td colSpan={5} className="border-t-0 pt-0 pe-2 pb-2 ps-0">
        {/* pinned to the scroller's left edge, so a table scrolled sideways
            on a phone still shows the line from its start */}
        <div className="sticky left-0 max-w-[100cqw] ps-10 text-xs text-gray-11">
          {payout.type === "returned" ? (
            <>
              Your bank sent this back, and the money is in your balance. Check
              your{" "}
              <Link
                to={href("/admin/:id/banking", { id: String(payout.npo_id) })}
                className="link font-medium"
              >
                bank details
              </Link>
              ; it goes out again once they're fixed.
            </>
          ) : (
            "Not counted as a grant."
          )}
        </div>
      </td>
    </tr>
  );
}

interface IReturnedGrant {
  amount: string;
}

/** a grant whose transfer the bank sent back: struck amount, status, and why */
export function ReturnedGrant({ amount }: IReturnedGrant) {
  return (
    <>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="line-through text-gray-11">{amount}</span>
        <PayoutStatus type="returned" />
      </div>
      <p className="text-sm text-gray-11 max-w-[44ch] mt-1">
        Your bank sent this grant back, so it isn't counted in your grant
        totals. It goes out again once your bank details are fixed.
      </p>
    </>
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
