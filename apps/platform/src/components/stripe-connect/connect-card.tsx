import {
  Actions,
  type AskProps,
  Badge,
  Modal,
  use_ask,
} from "@better-giving/ui";
import { CircleAlert, CircleCheck } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import {
  type TConnectIneligibility,
  TRANSFER_COUNTRIES_COPY,
} from "@/stripe-connect/eligibility";
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
  /** set when the npo can never route: the card says so and offers nothing */
  ineligible?: TConnectIneligibility;
  /** the Payouts page, linked from the ready state */
  payouts_href?: string;
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

const bodies: Record<TConnectStatus, string[]> = {
  not_connected: [
    "Connect your own Stripe account and donations paid through Stripe go straight to it, after fees: cards, digital wallets and bank debits. Stripe then pays your bank on Stripe's schedule.",
    "Everything else still pays out to your bank: stocks, DAF grants, crypto, PayPal and cheques. If you skip Stripe, Stripe donations go to your bank too.",
  ],
  disconnected: [
    "Stripe donations go to your bank payout.",
    "Reconnect Stripe to send them to your Stripe account again.",
  ],
  incomplete: [
    "Stripe needs a few more details before it can receive donations. Finish setup in your Stripe dashboard.",
    "Until Stripe says your account is ready, Stripe donations go to your bank payout. Nothing is lost, and you don't need to do anything else.",
  ],
  pending: [
    "Stripe is reviewing your account. Until it's ready, Stripe donations go to your bank payout.",
  ],
  ready: [
    "Donations paid through Stripe (cards, digital wallets and bank debits) now go straight to your Stripe account, after fees. Stripe pays them to your bank on its own schedule.",
    "Everything else still pays out to your bank. If you disconnect Better Giving in your Stripe dashboard, new Stripe donations go back to your bank.",
  ],
};

const ineligible_reasons = (i: TConnectIneligibility) =>
  i.reason === "fiscal_sponsored"
    ? "Stripe isn't available to fiscally sponsored nonprofits, so there's nothing to connect."
    : `Stripe isn't available for nonprofits headquartered in ${i.hq_country}. We can send Stripe donations to nonprofits headquartered in ${TRANSFER_COUNTRIES_COPY}.`;

/** Stripe beside bank details — registration step 4 and the banking page. */
export function StripeConnectCard({
  status,
  start_href,
  notice,
  ineligible,
  payouts_href,
  classes = "",
}: IStripeConnectCard) {
  const heading_id = useId();
  const ask = use_ask();

  if (ineligible) {
    return (
      <CardShell
        heading_id={heading_id}
        badge="Not available"
        classes={classes}
      >
        <Body>
          <p>{ineligible_reasons(ineligible)}</p>
          <p>
            All your donations, Stripe donations included, pay out to your bank.
            You don't need to do anything.
          </p>
        </Body>
      </CardShell>
    );
  }

  return (
    <CardShell
      heading_id={heading_id}
      badge="Optional"
      status={<StripeConnectStatus status={status} />}
      classes={classes}
    >
      {notice && (
        // keyed by the outcome, so a different one remounts and takes focus
        <NoticeBand key={`${notice.result}:${notice.reason}`} notice={notice} />
      )}

      <Body>
        {bodies[status].map((p) => (
          <p key={p}>{p}</p>
        ))}
        {status === "ready" && payouts_href && (
          <p>
            <Link to={payouts_href} className="link">
              See what's been sent on your Payouts page
            </Link>
          </p>
        )}
      </Body>

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
    </CardShell>
  );
}

interface ICardShell {
  heading_id: string;
  badge: string;
  status?: ReactNode;
  classes: string;
  children: ReactNode;
}

function CardShell({
  heading_id,
  badge,
  status,
  classes,
  children,
}: ICardShell) {
  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card grid gap-4`}
    >
      <div className="grid gap-1">
        {/* the badge sits beside the h2, not in it: the heading names the region */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={heading_id} className="text-lg font-semibold">
            Stripe account
          </h2>
          <Badge tone="neutral">{badge}</Badge>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

interface IBody {
  children: ReactNode;
}

function Body({ children }: IBody) {
  return (
    <div className="grid gap-2 text-sm text-gray-11 max-w-3xl">{children}</div>
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
      classes="bg-popover text-gray-12"
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
