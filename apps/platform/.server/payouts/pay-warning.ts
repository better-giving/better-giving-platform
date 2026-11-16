import { report_error } from "#/errors/report";
import type { Alert } from "@/slack";
import { stage } from "../env";
import { aws_monitor } from "../kit/slack";

/** a warning about a payout that went ahead (or may have): an own-account
 * match, or a check that could not run. never a refusal */
export interface IPayWarning {
  title: string;
  body: string;
  fields: NonNullable<Alert["fields"]>;
}

/** what `wise_pay` hands back once funding was accepted: the transfer, and any
 * warning for the caller to send AFTER it has recorded the payout */
export interface IPaid {
  id: number | string;
  warning?: IPayWarning;
}

/** an ops alert is given this long, so a stalled Slack cannot stall a run */
export const ALERT_MS = 3_000;

/** `p`'s answer, or `on_timeout` once `ms` pass */
export const within = <T>(ms: number, p: Promise<T>, on_timeout: () => T) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(on_timeout()), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

/**
 * sends a warning to ops. it never throws and never waits past `ALERT_MS`: a
 * Slack that rejects or stalls is reported and nothing else changes, so the
 * caller can send it anywhere after its own write without risking that write
 */
export async function send_pay_warning(w: IPayWarning | undefined) {
  if (!w) return;
  try {
    await within<unknown>(
      ALERT_MS,
      aws_monitor.send_alert({
        ...w,
        type: "ERROR",
        from: `wise-pay:${stage}`,
      }),
      () => {
        report_error(new Error("ops alert timed out"), { alert: w.title });
      }
    );
  } catch (err) {
    report_error(err, { alert: w.title });
  }
}

const carried = new WeakMap<object, IPayWarning>();

/**
 * a payment that threw after the transfer existed carries its warning on the
 * error itself, so the throw is never replaced or delayed. a thrown primitive
 * has nowhere to carry it, so it is sent at once, not awaited
 */
export function attach_warning(err: unknown, w: IPayWarning) {
  if (typeof err === "object" && err !== null) carried.set(err, w);
  else void send_pay_warning(w);
}

export const warning_of = (err: unknown): IPayWarning | undefined =>
  typeof err === "object" && err !== null ? carried.get(err) : undefined;
