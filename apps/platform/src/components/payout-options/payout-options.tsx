import { Accordion, Badge } from "@better-giving/ui";
import { useId } from "react";
import { type ICell, option_names, options, rows } from "./rows";

/** what a nonprofit has set up: a bank on file, and a Stripe account Stripe
 *  holds in any status (`is_linked`) */
export interface IPayoutRails {
  bank: boolean;
  stripe: boolean;
}

export interface IPayoutOptions {
  /** what is set up now, named on the row. absent, the row says what the
   *  comparison is for */
  current?: IPayoutRails;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

const OPEN_LINE = "You need one to get paid. Having both is possible.";

const current_line = ({ bank, stripe }: IPayoutRails) =>
  bank && stripe
    ? "Right now: Bank and Stripe. See how they differ."
    : bank
      ? "Right now: Bank. See how Bank and Stripe differ."
      : stripe
        ? "Right now: Stripe. See how Bank and Stripe differ."
        : "Right now: nothing set up. See how Bank and Stripe differ.";

/** Banking's "Compare your options": one row that opens Bank beside Stripe */
export function PayoutOptions({ current, classes = "" }: IPayoutOptions) {
  // the trigger's text is its accessible name and the heading's, so it stays
  // the same open or closed; `aria-expanded` carries the state
  const row_line = current ? current_line(current) : OPEN_LINE;
  return (
    <section aria-label="Compare your options" className={`${classes} card`}>
      <Accordion
        variant="box"
        heading_level={2}
        items={[
          {
            value: "compare",
            trigger: (
              <span className="grid gap-1">
                <span className="text-lg font-semibold">
                  Compare your options
                </span>
                <span className="text-sm font-normal text-gray-11">
                  {row_line}
                </span>
              </span>
            ),
            content: <Comparison lead={current ? OPEN_LINE : undefined} />,
          },
        ]}
      />
    </section>
  );
}

interface IComparison {
  /** what the comparison is for, when the row doesn't already say it */
  lead?: string;
}

function Comparison({ lead }: IComparison) {
  return (
    <div className="grid gap-4 border-t border-hairline pt-4 text-sm">
      {lead && <p className="text-gray-11">{lead}</p>}
      {/* the columns follow the box: Banking's views column is narrower than
          the window beside the sidebar */}
      <div className="@container">
        <div className="grid @2xl:grid-cols-2">
          {options.map((o) => (
            <Column key={o} option={o} />
          ))}
        </div>
      </div>
      <p className="border-t border-hairline pt-4 text-gray-11">
        <span className="font-semibold text-gray-12">Have both?</span> Once
        Stripe says your account is ready, Stripe donations go to Stripe.
        Everything else goes to your bank.
      </p>
    </div>
  );
}

interface IColumn {
  option: (typeof options)[number];
}

function Column({ option }: IColumn) {
  const heading_id = useId();
  return (
    // one hairline splits the two: below the first column on a phone, beside
    // it from `@2xl`
    <section
      aria-labelledby={heading_id}
      className="grid gap-3 content-start py-4 first:pt-0 last:pb-0 not-first:border-t not-first:border-hairline @2xl:py-0 @2xl:first:pr-6 @2xl:not-first:border-t-0 @2xl:not-first:border-l @2xl:not-first:pl-6"
    >
      <h3 id={heading_id} className="text-base font-semibold">
        {option_names[option]}
      </h3>
      <dl className="grid gap-3">
        {rows.map((r) => (
          <div key={r.term}>
            <dt className="font-medium">{r.term}</dt>
            <dd>
              <Cell cell={r.compare[option]} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface ICellView {
  cell: ICell;
}

/** a cell's sentence, the Held badge leading it when the money waits */
export function Cell({ cell }: ICellView) {
  if (!cell.held) return <span className="text-gray-11">{cell.text}</span>;
  return (
    <span className="inline-flex items-start gap-2">
      <Badge tone="warning" className="shrink-0">
        Held
      </Badge>
      <span className="text-gray-11">{cell.text}</span>
    </span>
  );
}
