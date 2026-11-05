import { Accordion, Badge, type BadgeTone } from "@better-giving/ui";
import { useId } from "react";
import { TRANSFER_COUNTRIES_COPY } from "@/stripe-connect/eligibility";

export interface IPayoutOptions {
  /** `open` on banking only while no Stripe account was ever linked
   * (`not_connected`); `collapsed` once one was, however far it got or if it
   * was disconnected since, and always on registration step 4 */
  variant: "open" | "collapsed";
  /** the collapsed trigger's second line */
  subtitle?: string;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

interface IFact {
  term: string;
  detail: string;
}

interface IOption {
  title: string;
  badge: string;
  tone: BadgeTone;
  lede: string;
  facts: IFact[];
}

const options: IOption[] = [
  {
    title: "Bank payout",
    badge: "Required",
    tone: "primary",
    lede: "We send your grants to your bank through Wise, a money-transfer service, in the currency you choose.",
    facts: [
      {
        term: "What it covers",
        detail:
          "Stocks, DAF grants, crypto, PayPal and cheques. Also card, wallet and bank-debit donations, until you connect Stripe.",
      },
      {
        term: "When you get it",
        detail: "Every 3 days, once your balance reaches your payout minimum.",
      },
      {
        term: "Where you see it",
        detail: "The Payouts list on your Payouts page.",
      },
      { term: "Who can use it", detail: "Every nonprofit." },
    ],
  },
  {
    title: "Stripe account",
    badge: "Optional",
    tone: "neutral",
    lede: "Donations paid through Stripe go straight to your own Stripe account instead of your bank payout.",
    facts: [
      {
        term: "What it covers",
        detail:
          "Donations paid through Stripe: cards, digital wallets and bank debits.",
      },
      {
        term: "When you get it",
        detail:
          "Each donation is sent to your Stripe account as its own transfer, after fees. Stripe then pays your bank on Stripe's schedule.",
      },
      {
        term: "Where you see it",
        detail:
          "Sent to your Stripe account on your Payouts page, and in your Stripe dashboard.",
      },
      {
        term: "Who can use it",
        detail: `Not available to fiscally sponsored nonprofits, or to nonprofits headquartered outside ${TRANSFER_COUNTRIES_COPY}.`,
      },
    ],
  },
];

/** "How you get paid" — the bank payout beside the optional Stripe account. */
export function PayoutOptions({
  variant,
  subtitle = "Your bank payout is required. Stripe is optional.",
  classes = "",
}: IPayoutOptions) {
  const heading_id = useId();

  if (variant === "collapsed") {
    return (
      <section aria-label="How you get paid" className={`${classes} card`}>
        {/* the h2 the open variant writes, wrapped round the trigger */}
        <Accordion
          heading_level={2}
          items={[
            {
              value: "how-you-get-paid",
              trigger: (
                <span className="grid">
                  <span className="font-semibold">How you get paid</span>
                  <span className="text-gray-11">{subtitle}</span>
                </span>
              ),
              content: <Comparison />,
            },
          ]}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card grid gap-4 text-sm`}
    >
      <div className="grid gap-1">
        <h2 id={heading_id} className="text-lg font-semibold">
          How you get paid
        </h2>
        <p className="text-gray-11">
          Every nonprofit has a bank payout. Connecting Stripe is optional.
        </p>
      </div>
      <Comparison />
    </section>
  );
}

function Comparison() {
  return (
    <div className="grid gap-4 text-sm text-gray-12">
      {/* columns follow the box, not the viewport: registration's column is
          narrower than the banking page's at the same window width */}
      <div className="@container">
        {/* not headings: the banking page's own sections are already named
            "Bank payout" and "Stripe account", and the outline would say each twice */}
        <ul className="grid gap-4 @3xl:grid-cols-2">
          {options.map((o) => (
            <Option key={o.title} {...o} />
          ))}
        </ul>
      </div>
      <div className="grid gap-2 border-t border-hairline pt-4">
        <p>
          <span className="font-semibold">Bank only:</span>{" "}
          <span className="text-gray-11">
            every donation, Stripe donations included, pays out to your bank.
          </span>
        </p>
        <p>
          <span className="font-semibold">Bank and Stripe:</span>{" "}
          <span className="text-gray-11">
            Stripe donations go to your Stripe account and everything else goes
            to your bank. If you disconnect Stripe, new Stripe donations go back
            to your bank.
          </span>
        </p>
      </div>
    </div>
  );
}

function Option({ title, badge, tone, lede, facts }: IOption) {
  return (
    <li className="bg-panel rounded p-4 grid gap-3 content-start">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{title}</p>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <p className="text-gray-11">{lede}</p>
      <dl className="grid gap-3">
        {facts.map((f) => (
          <div key={f.term}>
            <dt className="font-medium">{f.term}</dt>
            <dd className="text-gray-11">{f.detail}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
