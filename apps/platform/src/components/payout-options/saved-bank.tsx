import { Badge, ExtLink } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import { type Ref, useId } from "react";
import { BANK_PAYOUT_SENTENCE } from "./rows";

export interface ISavedBank {
  /** the recipient account's id at the payout provider */
  account_id: string;
  statement_href: string;
  onChange: () => void;
  /** focus lands here once a save replaces the form this card stands in for */
  heading_ref?: Ref<HTMLHeadingElement>;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

/** registration step 4's saved bank payout, under the Bank option */
export function SavedBank({
  account_id,
  statement_href,
  onChange,
  heading_ref,
  classes = "",
}: ISavedBank) {
  const heading_id = useId();
  return (
    <section
      aria-labelledby={heading_id}
      className={`${classes} card grid gap-3 text-sm`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3
            id={heading_id}
            ref={heading_ref}
            tabIndex={-1}
            className="text-lg font-semibold outline-0"
          >
            Bank payout
          </h3>
          <Badge tone="success">Saved</Badge>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onChange}
        >
          Change
        </button>
      </div>
      <p className="text-gray-11">{BANK_PAYOUT_SENTENCE}</p>
      <p>
        <span className="font-semibold">Account ID:</span>{" "}
        <span className="text-gray-11">{account_id}</span>
      </p>
      <ExtLink
        href={statement_href}
        className="flex items-center gap-2 link justify-self-start"
      >
        <SquareArrowOutUpRight aria-hidden className="icon-md" />
        <span>Bank statement</span>
      </ExtLink>
    </section>
  );
}
