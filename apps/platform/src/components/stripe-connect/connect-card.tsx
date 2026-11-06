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
  /** set when the npo can never route: the card says so and offers nothing
   *  of Stripe's */
  ineligible?: TConnectIneligibility;
  /** the Payouts page, linked from the ready state beside a bank */
  payouts_href?: string;
  /** a bank payout is on file: what isn't Stripe's pays out there. without
   *  one it waits in the balance, and so do Stripe donations until Stripe
   *  says the account is ready */
  has_bank: boolean;
  /** a bank account is filed and under review. read only while `has_bank`
   *  is false */
  bank_pending?: boolean;
  /** the add-bank page, through the router: linked from the not-available
   *  state while no bank is on file or under review */
  add_bank_href?: string;
  /** status, band and control only, where an option card above already
   *  says what Stripe does: registration step 4 */
  brief?: boolean;
  /** 3 under a page's own h2, as on registration step 4 */
  heading_level?: 2 | 3;
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

const with_replace = (href: string) =>
  `${href}${href.includes("?") ? "&" : "?"}replace=1`;

const READY_STRIPE_ONLY =
  "Stripe donations go straight to your Stripe account, after fees. What Stripe pays on to your own bank is in your Stripe dashboard.";

const bodies = (status: TConnectStatus, has_bank: boolean): string[] => {
  switch (status) {
    case "not_connected":
      return [
        `Connect Stripe to get Stripe donations straight to your Stripe account, after fees, once Stripe says your account is ready.${has_bank ? " Everything else keeps paying out to your bank." : ""}`,
      ];
    case "disconnected":
      return [
        "Better Giving was disconnected from your Stripe account in your Stripe dashboard. Connect Stripe again to get Stripe donations straight to your Stripe account, after fees, once Stripe says your account is ready.",
      ];
    case "incomplete":
      // without a bank, the standing band says it
      return has_bank
        ? [
            "Stripe needs a few more details before it can receive donations. Finish setup on Stripe, in your Stripe dashboard.",
            "Until you do and Stripe says your account is ready, Stripe donations go to your bank payout, so nothing is lost.",
          ]
        : [];
    case "pending":
      return has_bank
        ? [
            "Stripe is reviewing your account. Until it's ready, Stripe donations go to your bank payout.",
          ]
        : [];
    case "ready":
      return has_bank
        ? [
            "Stripe donations (cards, digital wallets and bank debits) go straight to your Stripe account, after fees. What Stripe pays on to your own bank is in your Stripe dashboard.",
            "Everything else pays out to your bank. If you disconnect Better Giving in your Stripe dashboard, Stripe donations go back to your bank.",
          ]
        : [READY_STRIPE_ONLY];
  }
};

type TBandTone = "success" | "warning" | "error";

interface IBand {
  tone: TBandTone;
  text: string;
}

/** the band a status keeps while it lasts, notice or not */
const standing_band = (
  status: TConnectStatus,
  has_bank: boolean
): IBand | null => {
  if (status === "ready")
    return { tone: "success", text: "Your Stripe account is connected." };
  if (has_bank) return null;
  if (status === "incomplete")
    return {
      tone: "warning",
      text: "Your Stripe account is connected, but Stripe hasn't finished setting it up. Finish on Stripe. Until it's ready, your Stripe donations are held too.",
    };
  if (status === "pending")
    return {
      tone: "warning",
      text: "Stripe is reviewing your account. Until it's ready, your Stripe donations are held too.",
    };
  return null;
};

const notice_tones: Record<IConnectNotice["result"], TBandTone> = {
  connected: "success",
  denied: "warning",
  error: "error",
};

const ineligible_reasons = (i: TConnectIneligibility) =>
  i.reason === "fiscal_sponsored"
    ? "Stripe isn't available to fiscally sponsored nonprofits, so there's nothing to connect."
    : `Stripe isn't available for nonprofits headquartered in ${i.hq_country}. We can send Stripe donations to nonprofits headquartered in ${TRANSFER_COUNTRIES_COPY}.`;

/** the not-available state: the bank is the only way to get paid */
const bank_only_line = (has_bank: boolean, bank_pending: boolean) =>
  has_bank
    ? "All your donations, Stripe donations included, pay out to your bank. You don't need to do anything."
    : bank_pending
      ? "Your bank account is under review. Until it's approved, all your donations, Stripe donations included, are held in your Better Giving balance. Nothing is lost."
      : "Until you add a bank account, all your donations, Stripe donations included, are held in your Better Giving balance. Nothing is lost.";

/** Stripe beside bank details — registration step 4 and the banking page. */
export function StripeConnectCard({
  status,
  start_href,
  notice,
  ineligible,
  payouts_href,
  has_bank,
  bank_pending = false,
  add_bank_href,
  brief = false,
  heading_level = 2,
  classes = "",
}: IStripeConnectCard) {
  const heading_id = useId();
  const ask = use_ask();

  if (ineligible) {
    return (
      <CardShell
        heading_id={heading_id}
        heading_level={heading_level}
        badge="Not available"
        classes={classes}
      >
        <Body>
          <p>{ineligible_reasons(ineligible)}</p>
          <p>{bank_only_line(has_bank, bank_pending)}</p>
          {!has_bank && !bank_pending && add_bank_href && (
            <p>
              <Link to={add_bank_href} className="link">
                Add a bank account
              </Link>
            </p>
          )}
        </Body>
      </CardShell>
    );
  }

  const standing = standing_band(status, has_bank);
  // a connect that landed is said by the status's own band where it has one
  const band: IBand | null =
    notice && !(notice.result === "connected" && standing)
      ? { tone: notice_tones[notice.result], text: notice_message(notice) }
      : standing;
  const body = brief && band ? [] : bodies(status, has_bank);
  const payouts_link = status === "ready" && has_bank && payouts_href;

  return (
    <CardShell
      heading_id={heading_id}
      heading_level={heading_level}
      status={<StripeConnectStatus status={status} />}
      classes={classes}
    >
      {band && (
        // keyed by the outcome, so a different one remounts and takes focus
        <Band
          key={notice ? `${notice.result}:${notice.reason}` : status}
          band={band}
          takes_focus={!!notice}
        />
      )}

      {(body.length > 0 || payouts_link) && (
        <Body>
          {body.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {payouts_link && (
            <p>
              <Link to={payouts_link} className="link">
                See what's been sent on your Payouts page
              </Link>
            </p>
          )}
        </Body>
      )}

      {status === "not_connected" || status === "disconnected" ? (
        // a revoked account has nothing left to replace, so nothing to confirm
        <a href={start_href} className="btn btn-secondary justify-self-start">
          Connect Stripe
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
  heading_level: 2 | 3;
  badge?: string;
  status?: ReactNode;
  classes: string;
  children: ReactNode;
}

function CardShell({
  heading_id,
  heading_level,
  badge,
  status,
  classes,
  children,
}: ICardShell) {
  const Heading = `h${heading_level}` as const;
  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card grid gap-4`}
    >
      <div className="grid gap-1">
        {/* the badge sits beside the h2, not in it: the heading names the region */}
        <div className="flex flex-wrap items-center gap-2">
          <Heading id={heading_id} className="text-lg font-semibold">
            Stripe account
          </Heading>
          {badge && <Badge tone="neutral">{badge}</Badge>}
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

// each band is an authored surface + its own ink (design-system.md)
const band_looks: Record<TBandTone, string> = {
  success: "bg-success-subtle text-success-subtle-fg",
  warning: "bg-warning-subtle text-warning-subtle-fg",
  error: "bg-destructive-subtle text-destructive-subtle-fg",
};

interface IBandView {
  band: IBand;
  /** the band says how the return from Stripe ended */
  takes_focus: boolean;
}

function Band({ band, takes_focus }: IBandView) {
  const ref = useRef<HTMLDivElement>(null);

  // the notice arrives on a full page load back from Stripe: a live region
  // mounted already holding it is announced by nobody, so focus carries it
  useEffect(() => {
    if (takes_focus) ref.current?.focus();
  }, [takes_focus]);

  const Icon = band.tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      ref={ref}
      tabIndex={takes_focus ? -1 : undefined}
      className={`flex items-start gap-2 rounded px-4 py-3 text-sm outline-0 ${band_looks[band.tone]}`}
    >
      <span className="h-lh flex items-center shrink-0">
        <Icon aria-hidden className="icon-md" />
      </span>
      <p>{band.text}</p>
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
