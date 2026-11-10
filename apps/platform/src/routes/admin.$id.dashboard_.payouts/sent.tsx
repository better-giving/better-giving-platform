import { EmptyRow, ExtLink } from "@better-giving/ui";
import { format } from "date-fns";
import { SquareArrowOutUpRight } from "lucide-react";
import { useId } from "react";
import { humanize } from "@/helpers/decimal";
import {
  type INpoSent,
  routed_label,
  type TRoutedKind,
  type TSentStanding,
  type TUnsentKind,
} from "@/stripe-connect/sent";

/** where a card gift made now goes: the connected account (`on`), or the bank
 * while the account stays linked (`off`, or `waiting` when nothing was ever
 * sent to it) or after a disconnect */
export type TStripeLink = "on" | "off" | "waiting" | "disconnected";

export const stripe_link = (sent: INpoSent): TStripeLink => {
  if (sent.on_stripe) return "on";
  if (!sent.connected) return "disconnected";
  return sent.items.length > 0 || sent.unsent.length > 0 ? "off" : "waiting";
};

interface ICopy {
  heading: string;
  lead: string;
}

/** where the account's bank stands, as far as the copy cares */
interface IBank {
  has_bank: boolean;
  bank_pending: boolean;
}

/** what new donations do without a bank: wait for one to be added, or for the
 * one filed to be approved */
const held_for_bank = (bank_pending: boolean) =>
  `wait in your Better Giving balance ${bank_pending ? "until your bank account is approved" : "until you add a bank account"}`;

/** where new Stripe donations go hangs on a bank: without one they wait */
const list_copy = (
  link: TStripeLink,
  { has_bank, bank_pending }: IBank
): ICopy => {
  switch (link) {
    case "on":
      return {
        heading: "Sent to your Stripe account",
        lead: "Each donation paid through Stripe is sent here as its own transfer, after fees.",
      };
    case "off":
      return {
        heading: "Sent to Stripe earlier",
        lead: `Stripe donations sent to your Stripe account before. New Stripe donations ${has_bank ? "pay out to your bank" : held_for_bank(bank_pending)}.`,
      };
    case "waiting":
      return {
        heading: "Your Stripe account",
        lead: `Your Stripe account is connected but isn't receiving Stripe donations, so new Stripe donations ${has_bank ? "pay out to your bank" : held_for_bank(bank_pending)}.`,
      };
    case "disconnected":
      return {
        heading: "Sent to Stripe earlier",
        lead: `Your Stripe account is disconnected, so new Stripe donations ${has_bank ? "pay out to your bank" : held_for_bank(bank_pending)}. These were sent to it while it was connected.`,
      };
  }
};

export interface ISentToStripe {
  sent: INpoSent;
  /** a bank payout is on file. without one, what Stripe doesn't take is held */
  has_bank?: boolean;
  /** no bank on file, and one filed waits for review: what is held waits for
   * its approval rather than for a bank to be added */
  bank_pending?: boolean;
  /** outer placement only — margin */
  classes?: string;
}

const usd = (n: number) => `$${humanize(n)}`;

interface ITone {
  label: string;
  ink: string;
  dot: string;
}

const tones: Record<TRoutedKind, ITone> = {
  sending: {
    label: routed_label("sending"),
    ink: "text-gray-11",
    dot: "bg-gray-9",
  },
  not_sent: {
    label: routed_label("not_sent"),
    ink: "text-warning-subtle-fg",
    dot: "bg-warning",
  },
  paid: {
    label: routed_label("paid"),
    ink: "text-success-subtle-fg",
    dot: "bg-success",
  },
  partial: {
    label: routed_label("partial"),
    ink: "text-warning-subtle-fg",
    dot: "bg-warning",
  },
  reversed: {
    label: routed_label("reversed"),
    ink: "text-destructive-subtle-fg",
    dot: "bg-destructive",
  },
  kept: {
    label: routed_label("kept"),
    ink: "text-warning-subtle-fg",
    dot: "bg-warning",
  },
  repaid: {
    label: routed_label("repaid"),
    ink: "text-gray-11",
    dot: "bg-gray-9",
  },
  unknown: {
    label: routed_label("unknown"),
    ink: "text-gray-11",
    dot: "bg-gray-9",
  },
};

interface IStanding {
  standing: TSentStanding | { kind: TUnsentKind };
}

function Standing({ standing }: IStanding) {
  const tone = tones[standing.kind];
  const label =
    standing.kind === "partial"
      ? `${tone.label} (${usd(standing.reversed)})`
      : tone.label;
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-medium ${tone.ink}`}
    >
      <span aria-hidden className={`w-2 h-2 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}

/** routed transfers paid to the nonprofit's connected account. balances, fees
 * and what reached the bank stay on stripe */
export function SentToStripe({
  sent,
  has_bank = true,
  bank_pending = false,
  classes = "",
}: ISentToStripe) {
  const heading_id = useId();
  const unsent_id = useId();
  const copy = list_copy(stripe_link(sent), { has_bank, bank_pending });
  return (
    <section aria-labelledby={heading_id} className={`${classes} grid gap-3`}>
      <div className="grid gap-1">
        <h2 id={heading_id} className="font-bold text-lg">
          {copy.heading}
        </h2>
        <p className="text-sm text-gray-11 max-w-3xl">
          {sent.truncated && "Showing the most recent. "}
          {copy.lead} What Stripe has paid on to your bank is in your{" "}
          <ExtLink
            href="https://dashboard.stripe.com/"
            className="inline-flex items-center gap-1 link"
          >
            <span>Stripe dashboard</span>
            <SquareArrowOutUpRight aria-hidden className="icon-sm" />
          </ExtLink>
          .
        </p>
      </div>
      <div className="table-scroll">
        <table className="table plain-zero-table" aria-labelledby={heading_id}>
          <thead>
            <tr>
              <th>Amount</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sent.items.length === 0 ? (
              <EmptyRow col_span={3}>No transfers yet</EmptyRow>
            ) : (
              sent.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span
                      className={
                        t.standing.kind === "reversed"
                          ? "line-through text-destructive-subtle-fg"
                          : ""
                      }
                    >
                      {usd(t.amount)}
                    </span>
                  </td>
                  <td>{format(t.date, "PP")}</td>
                  <td>
                    <Standing standing={t.standing} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {sent.unsent.length > 0 && (
        <div className="grid gap-2">
          <h3 id={unsent_id} className="font-semibold">
            Not sent to Stripe
          </h3>
          <div className="table-scroll">
            <table
              className="table plain-zero-table"
              aria-labelledby={unsent_id}
            >
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sent.unsent.map((u) => (
                  <tr key={u.id}>
                    <td>{usd(u.amount)}</td>
                    <td>{format(u.date, "PP")}</td>
                    <td>
                      <Standing standing={{ kind: u.kind }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

interface IWell {
  title: string;
  detail: string;
}

/** the stripe list's well, then the bank list's */
const wells = (link: TStripeLink, bank: IBank): [IWell, IWell] => {
  const title = list_copy(link, bank).heading;
  const { has_bank, bank_pending } = bank;
  switch (link) {
    case "on":
      return [
        {
          title,
          detail:
            "Donations paid through Stripe (cards, digital wallets and bank debits), each sent as its own transfer, after fees.",
        },
        {
          title: "Payouts",
          detail:
            "PayPal, DAF grants, crypto, stocks, cheques, and any Stripe donations from before you connected Stripe: the Grant share of each, sent to your bank.",
        },
      ];
    case "off":
    case "waiting":
      return [
        {
          title,
          detail:
            link === "off"
              ? "Stripe donations sent to your Stripe account before. New ones are not sent there."
              : "Nothing has been sent to your Stripe account. New Stripe donations are not sent there.",
        },
        {
          title: "Payouts",
          detail: has_bank
            ? "Everything sent to your bank, new Stripe donations included."
            : `Everything sent to your bank before. New donations, Stripe donations included, ${held_for_bank(bank_pending)}.`,
        },
      ];
    case "disconnected":
      return [
        {
          title,
          detail:
            "Stripe donations sent to your Stripe account while it was connected.",
        },
        {
          title: "Payouts",
          detail: has_bank
            ? "Everything sent to your bank. Your Stripe account is disconnected, so new Stripe donations are here too."
            : `Everything sent to your bank before. Your Stripe account is disconnected, so new donations, Stripe donations included, ${held_for_bank(bank_pending)}.`,
        },
      ];
  }
};

export interface IWhereMoneyShows {
  link: TStripeLink;
  /** as on `SentToStripe` */
  has_bank?: boolean;
  /** as on `SentToStripe` */
  bank_pending?: boolean;
}

/** which of the page's two lists a donation lands in. mount it only beside
 * both */
export function WhereMoneyShows({
  link,
  has_bank = true,
  bank_pending = false,
}: IWhereMoneyShows) {
  const heading_id = useId();
  return (
    <section aria-labelledby={heading_id} className="card grid gap-3 text-sm">
      <h2 id={heading_id} className="text-lg font-semibold">
        Where your money shows
      </h2>
      {/* columns follow the box, as in `PayoutOptions` */}
      <div className="@container">
        <div className="grid gap-4 @3xl:grid-cols-2">
          {wells(link, { has_bank, bank_pending }).map((w) => (
            <div
              key={w.title}
              className="bg-panel rounded p-4 grid gap-1 content-start"
            >
              <h3 className="font-semibold">{w.title}</h3>
              <p className="text-gray-11">{w.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
