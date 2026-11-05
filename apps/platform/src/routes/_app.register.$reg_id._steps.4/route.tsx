import { Actions, Button, use_ask_prompt } from "@better-giving/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { BankDetails, type OnSubmit } from "#/components/bank-details";
import {
  BankRequired,
  is_linked,
  PayoutChoice,
  SavedBank,
  type TPayoutOption,
} from "#/components/payout-options";
import { StripeConnectCard } from "#/components/stripe-connect/connect-card";
import { submit_error_prompt } from "#/helpers/error-prompt";
import { use_strip_connect_params } from "#/hooks/use-strip-connect-params";
import { step_loader } from "#/pages/registration/data/step-loader";
import { before_banking, steps } from "#/pages/registration/routes";
import { update_action } from "#/pages/registration/update-action";
import type { TRegUpdate } from "@/reg";
import {
  connect_notice,
  connect_start_href,
  type IConnectCardData,
  reg_ineligibility,
} from "@/stripe-connect/card-data";
import { stripe as stripe_env } from "$/env";
import { account_status_live } from "$/stripe-connect/sync";
import type { Route } from "./+types/route";
import { form_buttons } from "./form-buttons";

export { ErrorBoundary } from "#/components/error";

const reg_step = step_loader(4);
export const loader = async (args: Route.LoaderArgs) => {
  const reg = await reg_step(args);
  if (reg instanceof Response) return reg;
  const connect_routing = stripe_env.connect_routing;
  const acct = reg.o_stripe_account_id;
  // both are set by the steps before this one; unset reads as nothing to judge
  const ineligible =
    (connect_routing &&
      reg_ineligibility({
        o_type: reg.o_type ?? "",
        o_hq_country: reg.o_hq_country ?? "",
      })) ||
    undefined;
  const stripe: IConnectCardData = {
    // an org stripe can never pay is not offered stripe, so stripe isn't asked
    status:
      connect_routing && acct && !ineligible
        ? await account_status_live(acct)
        : "not_connected",
    start_href: connect_start_href({ kind: "reg", reg_id: reg.id }),
    ...(connect_routing &&
      !ineligible && {
        notice: connect_notice(args.url),
      }),
    ...(ineligible && { ineligible }),
  };
  return { ...reg, stripe, connect_routing };
};
// a saved bank comes back here, not on to the summary: the saved state is
// where stripe is offered, and Continue moves on
export const action = update_action(steps.banking, { next_always: true });

export default function Page({ loaderData: reg }: Route.ComponentProps) {
  const [is_changing, set_is_changing] = useState(false);
  // a press on an option; until one, the option shown is what is saved
  const [picked, set_picked] = useState<TPayoutOption | null>(null);
  const fetcher = useFetcher();
  // a change that landed redirects back to this same route, which stays
  // mounted, so the form is closed here, as the save settles without a failure
  const [fetcher_state, set_fetcher_state] = useState(fetcher.state);
  if (fetcher_state !== fetcher.state) {
    set_fetcher_state(fetcher.state);
    // sound only while every success redirects and every failure is `resp.fail`
    if (fetcher.state === "idle" && !fetcher.data?.message) {
      set_is_changing(false);
    }
  }
  const ask_prompt = use_ask_prompt();
  const back = before_banking(reg.o_type);
  // stable identity — BankDetails renders it as a component
  const FormButtons = useMemo(() => form_buttons(back), [back]);
  use_strip_connect_params(reg.connect_routing && !!reg.stripe.notice);
  const offers_stripe = reg.connect_routing && !reg.stripe.ineligible;

  const submit: OnSubmit = async (recipient, bank_statement) => {
    const update: TRegUpdate = {
      update_type: "banking",
      o_bank_statement: bank_statement,
      o_bank_id: recipient.id.toString(),
    };
    // a redirect brings no data, so the last failure's would outlive the save
    // that follows it and hold the form open
    fetcher.reset();
    fetcher.submit(update, {
      method: "PATCH",
      encType: "application/json",
    });
  };

  // a rejected update resolves the submit instead of throwing: the action
  // returns a tagged failure (`resp.fail`) the client reads off `fetcher.data`,
  // while a landed save redirects and leaves it empty.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    ask_prompt(
      submit_error_prompt(fetcher.data, {
        context: "saving your banking details",
      }),
      { key: "reg-banking-submit-error" }
    );
  }, [fetcher.state, fetcher.data, ask_prompt]);

  const bank_saved = !!reg.o_bank_id;
  const shows_saved = bank_saved && !is_changing;
  // the form that held focus is gone once the saved card replaces it; a
  // saved bank there on arrival is not a change, so focus stays put
  const saved_heading = useRef<HTMLHeadingElement>(null);
  const showed_saved = useRef(shows_saved);
  useEffect(() => {
    if (shows_saved && !showed_saved.current) saved_heading.current?.focus();
    showed_saved.current = shows_saved;
  }, [shows_saved]);

  // Change unmounts the button that held focus, so it moves into the form
  const bank_form_field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (is_changing) bank_form_field.current?.focus();
  }, [is_changing]);

  const bank = shows_saved ? (
    <SavedBank
      account_id={reg.o_bank_id ?? ""}
      statement_href={reg.o_bank_statement ?? ""}
      onChange={() => set_is_changing(true)}
      heading_ref={saved_heading}
    />
  ) : (
    <div className="grid gap-3">
      {is_changing && (
        <button
          className="btn btn-secondary btn-sm justify-self-end"
          type="button"
          onClick={() => set_is_changing(false)}
        >
          Cancel
        </button>
      )}
      <BankDetails
        verified
        first_field_ref={bank_form_field}
        FormButtons={FormButtons}
        onSubmit={submit}
        is_loading={fetcher.state !== "idle"}
      />
    </div>
  );

  const back_to = `../${back}`;
  const continue_to = `../${steps.summary}`;

  if (!offers_stripe) {
    return (
      <BankRequired ineligible={reg.stripe.ineligible}>
        {bank}
        {shows_saved && (
          <Actions>
            <Button variant="secondary" to={back_to} classes="min-w-32">
              Back
            </Button>
            <Button variant="primary" to={continue_to} classes="min-w-32">
              Continue
            </Button>
          </Actions>
        )}
      </BankRequired>
    );
  }

  // back from stripe, the attempt is what the applicant came to see
  const saved_choice: TPayoutOption | null = reg.stripe.notice
    ? "stripe"
    : bank_saved
      ? "bank"
      : is_linked(reg.stripe.status)
        ? "stripe"
        : null;

  return (
    <PayoutChoice
      selected={picked ?? saved_choice}
      onSelect={(option) => {
        set_picked(option);
        // the form unmounts off Bank, so its change is dropped with it
        if (option !== "bank") set_is_changing(false);
      }}
      bank_saved={bank_saved}
      bank_form_open={is_changing}
      stripe_status={reg.stripe.status}
      bank={bank}
      stripe={
        <StripeConnectCard
          {...reg.stripe}
          brief
          heading_level={3}
          has_bank={bank_saved}
        />
      }
      back_to={back_to}
      continue_to={continue_to}
    />
  );
}
