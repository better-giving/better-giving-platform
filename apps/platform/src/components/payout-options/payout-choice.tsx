import { RadioGroup as Ark } from "@ark-ui/react/radio-group";
import { Actions, Button } from "@better-giving/ui";
import { type ReactNode, useId } from "react";
import { TRANSFER_COUNTRIES_COPY } from "@/stripe-connect/eligibility";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { Cell } from "./payout-options";
import {
  BANK_PAYOUT_LINE,
  is_linked,
  option_names,
  option_summaries,
  options,
  rows,
  type TPayoutOption,
} from "./rows";

export interface IPayoutChoice {
  /** the option shown as chosen: what the wizard has saved, or the press
   *  before anything is. null while neither */
  selected: TPayoutOption | null;
  onSelect: (option: TPayoutOption) => void;
  /** a bank payout is saved on the registration, being changed or not */
  bank_saved: boolean;
  /** the bank form is open over a saved bank (its Change was pressed). the
   *  saved bank still pays out until a new one is saved. ignored while no
   *  bank is saved, since the form is the only thing Bank shows then */
  bank_form_open?: boolean;
  /** the registration's Stripe account; `not_connected` when it has none */
  stripe_status: TConnectStatus;
  /** under the options while Bank is chosen: `SavedBank`, or the bank form.
   *  the form carries its own Back and Submit (and Cancel over a saved bank),
   *  so this component draws no Back then, and Continue only once Stripe is
   *  linked and no bank is saved */
  bank: ReactNode;
  /** under the options while Stripe is chosen: `StripeConnectCard` with
   *  `brief`, `heading_level={3}` and `has_bank` */
  stripe: ReactNode;
  back_to: string;
  continue_to: string;
  /** outer placement only — margin, grid placement */
  classes?: string;
}

/** registration step 4: Bank or Stripe, either one finishes onboarding */
export function PayoutChoice({
  selected,
  onSelect,
  bank_saved,
  bank_form_open = false,
  stripe_status,
  bank,
  stripe,
  back_to,
  continue_to,
  classes = "",
}: IPayoutChoice) {
  const heading_id = useId();
  const hint_id = useId();
  const stripe_linked = is_linked(stripe_status);
  const stripe_ready = stripe_status === "ready";
  const can_continue = bank_saved || stripe_linked;
  // the bank form draws its own Back and Submit
  const form_shown = selected === "bank" && (!bank_saved || bank_form_open);
  // the chosen option is set up, so there is nothing left to explain here
  const is_done =
    (selected === "bank" && bank_saved && !form_shown) ||
    (selected === "stripe" && stripe_linked);

  const hint = can_continue
    ? null
    : selected === "stripe"
      ? "Connect Stripe to continue."
      : "Choose an option to continue.";

  return (
    <div className={`${classes} grid gap-6 content-start`}>
      <section aria-labelledby={heading_id} className="grid gap-2">
        <h2 id={heading_id} className="text-xl">
          Choose how you get paid
        </h2>
        <p className="text-sm text-gray-11">
          {intro(selected, bank_saved, form_shown, stripe_status)}
        </p>
      </section>

      <Ark.Root
        value={selected}
        onValueChange={(e) => e.value && onSelect(e.value as TPayoutOption)}
        className="grid gap-3"
      >
        <Ark.Label className="text-sm font-semibold">
          How do you want to get paid?
        </Ark.Label>
        {options.map((o) => (
          <OptionCard
            key={o}
            option={o}
            expanded={!selected || selected === o}
            stripe_ready={stripe_ready}
            bank_saved={bank_saved}
          />
        ))}
        {!is_done && (
          <p className="text-xs text-gray-11">
            {BANK_PAYOUT_LINE} Stripe is available to nonprofits in{" "}
            {TRANSFER_COUNTRIES_COPY}.
          </p>
        )}
      </Ark.Root>

      {selected === "bank" && bank}
      {selected === "stripe" && stripe}
      {selected === "stripe" && stripe_linked && !bank_saved && (
        <p className="text-sm text-gray-11">
          Want everything to pay out? Add a bank account here too, or any time
          from Banking. Held money is never lost.
        </p>
      )}

      {/* over a saved bank the form's Cancel is the way back to Continue */}
      {form_shown && !bank_saved && stripe_linked && (
        <Actions>
          <Button variant="primary" to={continue_to} classes="min-w-32">
            Continue without a bank account
          </Button>
        </Actions>
      )}
      {!form_shown && (
        <div className="grid gap-2">
          <Actions>
            <Button variant="secondary" to={back_to} classes="min-w-32">
              Back
            </Button>
            <Button
              variant="primary"
              to={continue_to}
              disabled={!can_continue}
              aria-describedby={hint ? hint_id : undefined}
              classes="min-w-32"
            >
              Continue
            </Button>
          </Actions>
          {hint && (
            <p id={hint_id} className="text-xs text-gray-11">
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function intro(
  selected: TPayoutOption | null,
  bank_saved: boolean,
  bank_form_shown: boolean,
  stripe_status: TConnectStatus
) {
  const linked = is_linked(stripe_status);
  if (selected === "bank" && bank_saved)
    return bank_form_shown
      ? "Your saved bank payout stays in place until you save a new one."
      : "Your bank payout is saved. You can continue now, and add Stripe here too, or any time from Banking.";
  // the line under the Stripe card offers the bank while none is saved
  if (selected === "stripe" && linked)
    return stripe_status === "ready"
      ? "Your Stripe account is ready. You can continue now."
      : "Your Stripe account is connected. You can continue now.";
  // the other option is the one set up
  if (linked)
    return "Your Stripe account is connected, so you can continue now. Add a bank account here too, or any time from Banking.";
  if (bank_saved)
    return "Your bank payout is saved, so you can continue now. Connect Stripe here too, or any time from Banking.";
  return "We need one to finish onboarding. You can add the other later from Banking.";
}

interface IOptionCard {
  option: TPayoutOption;
  /** the chosen card, or both while neither is */
  expanded: boolean;
  /** the Stripe card's first row drops its until-ready clause */
  stripe_ready: boolean;
  /** the Stripe card sends what it can't receive to the bank, not to held */
  bank_saved: boolean;
}

// the radio's own dot, as `RadioGroup` draws it in @better-giving/ui
const radio_control =
  "flex size-5 shrink-0 items-center justify-center rounded-full border border-input hover:not-data-disabled:border-input-hover bg-surface transition-colors data-[state=checked]:bg-primary data-[state=checked]:border-primary data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-ring";

function OptionCard({
  option,
  expanded,
  stripe_ready,
  bank_saved,
}: IOptionCard) {
  const desc_id = useId();
  return (
    // the label (Ark's Item) holds the radio, the option's name and its
    // summary; the rows sit beside it, since a label holds phrasing content
    // only. the name is the radio's, so it is no heading
    <div className="grid gap-3 rounded-card border border-gray-7 bg-surface p-4 has-[label:hover]:not-has-data-[state=checked]:border-gray-8 has-data-[state=checked]:border-primary has-data-[state=checked]:outline-1 has-data-[state=checked]:-outline-offset-2 has-data-[state=checked]:outline-primary">
      <Ark.Item
        value={option}
        className="group flex items-start gap-3 cursor-pointer"
      >
        <span className="h-lh flex items-center text-lg">
          <Ark.ItemControl className={radio_control}>
            <span className="invisible size-2 rounded-full bg-primary-fg group-data-[state=checked]:visible" />
          </Ark.ItemControl>
        </span>
        <span className="grid">
          <Ark.ItemText className="font-display text-lg font-semibold">
            {option_names[option]}
          </Ark.ItemText>
          <span id={desc_id} className="text-sm text-gray-11">
            {option_summaries[option]}
          </span>
        </span>
        <Ark.ItemHiddenInput aria-describedby={desc_id} />
      </Ark.Item>
      {expanded && (
        <div className="@container ml-8 border-t border-hairline pt-3">
          <dl className="grid gap-2 text-sm @lg:grid-cols-3 @lg:gap-x-4">
            {rows.map((r) => {
              if (!r.card) return null;
              const cell =
                option === "bank"
                  ? r.card.bank
                  : stripe_ready && r.card_stripe_ready
                    ? { text: r.card_stripe_ready }
                    : bank_saved
                      ? r.card.stripe_with_bank
                      : r.card.stripe;
              return (
                <div
                  key={r.term}
                  className="grid gap-1 @lg:col-span-3 @lg:grid-cols-subgrid"
                >
                  <dt className="font-medium">{r.term}</dt>
                  <dd className="@lg:col-span-2">
                    <Cell cell={cell} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}
