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

interface IConnectNotice {
  result: TConnectResult;
  reason?: TConnectErrorReason;
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
   *  one it waits in the balance, and so do card, bank and wallet donations
   *  until Stripe says the account is ready */
  has_bank: boolean;
  /** a bank account is filed and under review. read only while `has_bank`
   *  is false */
  bank_pending?: boolean;
  /** registration step 4: the Stripe option card above already says where
   *  card, bank and wallet donations go before and once the account is
   *  ready, so the body keeps only what that row can't say, and none where
   *  a band speaks */
  brief?: boolean;
  /** the held-money card shows above, carrying its own Connect Stripe while
   *  no account is linked, so the page keeps one. it never shows beside a
   *  bank */
  holds_money?: boolean;
  /** 3 under a page's own h2, as on registration step 4 */
  heading_level?: 2 | 3;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

const reason_messages: Record<TConnectErrorReason, string> = {
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

/** the first mention in a state's body; later sentences say "they" or "them"
 *  unless another plural sits nearer */
const FIRST =
  "card, bank and wallet donations (like Apple Pay, Google Pay and Link)";
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const SENT_AS_TRANSFER =
  "go straight to your Stripe account as each donation's own transfer, after fees. They skip your Grant, Savings and Investments split.";
const PAYS_ON =
  "What Stripe pays on to the bank on your Stripe account is in your Stripe dashboard.";
const DISCONNECTED =
  "Better Giving was disconnected from your Stripe account in your Stripe dashboard.";
const KEPT_ON_STRIPE =
  "Donations already sent to your Stripe account stay there.";
const FINISH_SETUP =
  "Stripe needs a few more details before it can receive donations. Finish setup on Stripe, in your Stripe dashboard.";

const bodies = (
  status: TConnectStatus,
  has_bank: boolean,
  holds_money: boolean
): string[] => {
  switch (status) {
    case "not_connected":
      return [
        `Once Stripe says your account is ready, ${FIRST} ${SENT_AS_TRANSFER} Until then, ${has_bank ? "they go to your bank" : "they're held in your Better Giving balance"}.`,
      ];
    case "disconnected":
      if (has_bank)
        return [
          `${DISCONNECTED} ${cap(FIRST)} now go to your bank.`,
          `Connect Stripe again to get them straight to your Stripe account, after fees, once Stripe says your account is ready. ${KEPT_ON_STRIPE}`,
        ];
      // the held card above already says Stripe is disconnected and carries
      // Connect Stripe, so only what it never says is left
      return holds_money
        ? [KEPT_ON_STRIPE]
        : [
            `${DISCONNECTED} Connect Stripe again to get ${FIRST} straight to your Stripe account, after fees, once Stripe says your account is ready. ${KEPT_ON_STRIPE}`,
          ];
    case "incomplete":
      // without a bank, the standing band says it
      return has_bank
        ? [
            FINISH_SETUP,
            `Until you do and Stripe says your account is ready, ${FIRST} go to your bank, so nothing is lost. Then each one goes straight to your Stripe account, after fees, and skips your Grant, Savings and Investments split.`,
          ]
        : [];
    case "pending":
      return has_bank
        ? [
            `Stripe is reviewing your account. Until it's ready, ${FIRST} go to your bank.`,
          ]
        : [];
    case "ready":
      return [
        `${cap(FIRST)} ${SENT_AS_TRANSFER} ${PAYS_ON}${has_bank ? " If you disconnect Better Giving in your Stripe dashboard, card, bank and wallet donations go to your bank again." : ""}`,
      ];
  }
};

/** step 4's body: the Stripe option row above says where card, bank and
 *  wallet donations go until and once the account is ready, and the status
 *  line names the status, so only what neither says is left */
const brief_bodies = (status: TConnectStatus, has_bank: boolean): string[] => {
  if (status === "disconnected") return [`${DISCONNECTED} ${KEPT_ON_STRIPE}`];
  if (status === "incomplete" && has_bank) return [FINISH_SETUP];
  return [];
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
  if (has_bank) return null;
  if (status === "incomplete")
    return {
      tone: "warning",
      text: "Your Stripe account is connected, but Stripe hasn't finished setting it up. Finish on Stripe. Until it's ready, your card, bank and wallet donations are held too.",
    };
  if (status === "pending")
    return {
      tone: "warning",
      text: "Stripe is reviewing your account. Until it's ready, your card, bank and wallet donations are held too.",
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
    : `Stripe isn't available for nonprofits headquartered in ${i.hq_country}. We can send card, bank and wallet donations to a Stripe account for nonprofits headquartered in ${TRANSFER_COUNTRIES_COPY}.`;

/** the not-available state: the bank is the only way to get paid */
const bank_only_line = (has_bank: boolean, bank_pending: boolean) =>
  has_bank
    ? "All your donations, including card, bank and wallet donations, pay out to your bank. You don't need to do anything."
    : bank_pending
      ? "Your bank account is under review. Until it's approved, all your donations, including card, bank and wallet donations, are held in your Better Giving balance. Nothing is lost."
      : "Until you add a bank account, all your donations, including card, bank and wallet donations, are held in your Better Giving balance. Nothing is lost.";

/** Stripe beside bank details — registration step 4 and the banking page. */
export function StripeConnectCard({
  status,
  start_href,
  notice,
  ineligible,
  payouts_href,
  has_bank,
  bank_pending = false,
  brief = false,
  holds_money = false,
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
  const body = !brief
    ? bodies(status, has_bank, holds_money)
    : band
      ? []
      : brief_bodies(status, has_bank);
  const payouts_link = status === "ready" && has_bank && payouts_href;
  const connects = status === "not_connected" || status === "disconnected";

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

      {connects ? (
        // a revoked account has nothing left to replace, so nothing to confirm
        !holds_money && (
          <a href={start_href} className="btn btn-secondary justify-self-start">
            Connect Stripe
          </a>
        )
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
        {/* the badge sits beside the heading, not in it: the heading names the region */}
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
