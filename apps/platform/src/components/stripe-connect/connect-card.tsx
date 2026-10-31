import { Actions, type AskProps, Modal, use_ask } from "@better-giving/ui";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type {
  TConnectErrorReason,
  TConnectResult,
} from "@/stripe-connect/return";
import { StripeConnectStatus, type TConnectStatus } from "./status";

export type TConnectNoticeReason = TConnectErrorReason;

export interface IConnectNotice {
  result: TConnectResult;
  reason?: TConnectNoticeReason;
}

export interface IStripeConnectCard {
  status: TConnectStatus;
  /** the server route that redirects to Stripe — navigated to in full, never
   *  through the router */
  start_href: string;
  /** outcome of the attempt that just came back from Stripe. one-shot: pass it
   *  on the render that follows the return, and not again */
  notice?: IConnectNotice;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

const reason_messages: Record<TConnectNoticeReason, string> = {
  already_linked:
    "That Stripe account is already linked to another nonprofit. Connect a different one.",
  replace_unconfirmed:
    "Your connected Stripe account wasn't changed. To switch, choose Connect a different account and confirm.",
  expired: "The link to Stripe timed out. Try again.",
  forbidden: "You don't have permission to connect a Stripe account here.",
  failed: "We couldn't connect your Stripe account. Try again.",
};

function notice_message({ result, reason }: IConnectNotice) {
  if (result === "connected") return "Your Stripe account is connected.";
  if (reason) return reason_messages[reason];
  if (result === "denied")
    return "You didn't approve access on Stripe, so nothing was connected.";
  return reason_messages.failed;
}

// each band is an authored surface + its own ink (design-system.md)
const bands: Record<IConnectNotice["result"], string> = {
  connected: "bg-success-subtle text-success-subtle-fg",
  denied: "bg-warning-subtle text-warning-subtle-fg",
  error: "bg-destructive-subtle text-destructive-subtle-fg",
};

const with_replace = (href: string) =>
  `${href}${href.includes("?") ? "&" : "?"}replace=1`;

/** Stripe beside bank details — registration step 4 and the banking page. */
export function StripeConnectCard({
  status,
  start_href,
  notice,
  classes = "",
}: IStripeConnectCard) {
  const heading_id = useId();
  const ask = use_ask();

  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card grid gap-4`}
    >
      <div className="grid gap-1">
        <h2 id={heading_id} className="text-lg font-semibold">
          Stripe account
        </h2>
        <StripeConnectStatus status={status} />
      </div>

      {notice && (
        // keyed by the outcome, so a different one remounts and takes focus
        <NoticeBand key={`${notice.result}:${notice.reason}`} notice={notice} />
      )}

      <div className="grid gap-2 text-sm text-gray-11">
        <p>
          Once enabled, card donations will go straight to your Stripe account.
        </p>
        <p>
          Keep your bank details too: stock, DAF, crypto, PayPal and cheque
          donations still pay out to your bank.
        </p>
      </div>

      {status === "not_connected" || status === "disconnected" ? (
        // a revoked account has nothing left to replace, so nothing to confirm
        <a href={start_href} className="btn btn-primary justify-self-start">
          {status === "disconnected"
            ? "Reconnect Stripe"
            : "Connect with Stripe"}
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-secondary justify-self-start"
          onClick={() =>
            ask(ReplaceConfirm, { href: with_replace(start_href) })
          }
        >
          Connect a different account
        </button>
      )}
    </section>
  );
}

interface INoticeBand {
  notice: IConnectNotice;
}

function NoticeBand({ notice }: INoticeBand) {
  const ref = useRef<HTMLDivElement>(null);
  const { result } = notice;

  // the notice arrives on a full page load back from Stripe: a live region
  // mounted already holding it is announced by nobody, so focus carries it
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const Icon = result === "connected" ? CircleCheck : CircleAlert;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`flex items-start gap-2 rounded px-4 py-3 text-sm outline-0 ${bands[result]}`}
    >
      <span className="h-lh flex items-center shrink-0">
        <Icon aria-hidden className="icon-md" />
      </span>
      <p>{notice_message(notice)}</p>
    </div>
  );
}

interface IReplaceConfirm {
  href: string;
}

/** asked, never mounted directly. the commit is a plain link — leaving for
 *  Stripe is a full navigation, so there is no answer to hand back. */
function ReplaceConfirm({
  href,
  open,
  resolve,
  on_closed,
}: IReplaceConfirm & AskProps) {
  return (
    <Modal
      open={open}
      onClose={() => resolve()}
      onExitComplete={on_closed}
      classes="bg-card text-gray-12"
    >
      <div className="p-6 sm:p-8 grid gap-2">
        <h3 className="text-lg font-bold">
          Connect a different Stripe account?
        </h3>
        <p className="text-sm text-gray-11">
          You'll pick another account on Stripe. When you finish there, it
          replaces the account connected now.
        </p>
      </div>
      <Actions band>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => resolve()}
        >
          Keep current account
        </button>
        <a href={href} className="btn btn-primary">
          Continue to Stripe
        </a>
      </Actions>
    </Modal>
  );
}
