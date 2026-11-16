/** what the grants-run and commission-payout return polls share: the stored
 * transfer states, wise's states and how each is acted on, the lookup shape
 * and the ops alert */
import { report_error } from "#/errors/report";
import type { Alert } from "@/slack";
import { stage } from "../env";
import { aws_monitor } from "../kit/slack";

/** the state a settlement takes once its money is back in the npo's books */
export const RETURNED = "returned";
/** its transfer came back but which payouts are its own can't be decided: not
 * final, so polling goes on, and nothing is credited until ops repairs it */
export const AWAITING_REPAIR = "awaiting_repair";

/** a transfer's wise state by its id, with the recipient it paid (wise's
 * `targetAccount`) when the caller has it */
export type TransferState = (
  transfer_id: number
) => Promise<string | { status: string; recipient?: string }>;

export const read_transfer = async (state_of: TransferState, id: string) => {
  const t = await state_of(Number(id));
  return typeof t === "string" ? { status: t, recipient: undefined } : t;
};

/** stored states nothing polls again: ours once the money is back, and
 * `charged_back`, whose payouts stay bounced for ops to resolve by hand. not `cancelled`: every polled transfer was funded, and a
 * funded one passes through `cancelled` on its way to `funds_refunded` */
export const CHARGED_BACK = "charged_back";
export const FINAL = [RETURNED, CHARGED_BACK] as const;
/**
 * wise's transfer states (`@/payouts/wise-path`). `bounced_back` is not the
 * money back: wise may still deliver it late or move it on to
 * `funds_refunded`, which alone is taken back. a payout is settled only from
 * `DELIVERED`, and bounced from any state off the ordinary path
 */
export {
  DELIVERED,
  MONEY_BACK,
  ORDINARY,
  WINDOW_DAYS,
} from "@/payouts/wise-path";
/** off the ordinary path and possibly on to `MONEY_BACK`, where the poll takes
 * the run back by itself: settling the payouts by hand too would count the
 * money twice */
export const RETURNING: ReadonlySet<string> = new Set([
  "bounced_back",
  "cancelled",
]);

/** an alert that fails to send is reported, never thrown past the money;
 * an `ERROR` unless `type` says otherwise */
export async function alert(a: Omit<Alert, "from">) {
  try {
    await aws_monitor.send_alert({
      type: "ERROR",
      ...a,
      from: `wise-returns:${stage}`,
    });
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}
