import { Actions, Badge, ExtLink, use_ask_prompt } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NavLink, useFetcher } from "react-router";
import { BankDetails, type OnSubmit } from "#/components/bank-details";
import { PayoutOptions } from "#/components/payout-options";
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
  payout_options_variant,
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
    // the not-available card shows no status, so stripe isn't asked for one
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
  const fetcher = useFetcher();
  // a change that landed redirects back to this same route, which stays
  // mounted — so the form is closed here, as the save settles without a failure
  const [fetcher_state, set_fetcher_state] = useState(fetcher.state);
  if (fetcher_state !== fetcher.state) {
    set_fetcher_state(fetcher.state);
    // sound only while every success redirects and every failure is `resp.fail`
    if (fetcher.state === "idle" && !fetcher.data?.message) {
      set_is_changing(false);
    }
  }
  const ask_prompt = use_ask_prompt();
  const heading_id = useId();
  const back = before_banking(reg.o_type);
  // stable identity — BankDetails renders it as a component
  const FormButtons = useMemo(() => form_buttons(back), [back]);
  use_strip_connect_params(reg.connect_routing && !!reg.stripe.notice);
  const offers_stripe = reg.connect_routing && !reg.stripe.ineligible;
  const payout_options = offers_stripe && (
    <PayoutOptions variant={payout_options_variant(reg.stripe.status)} />
  );
  const stripe_card = reg.connect_routing ? (
    <StripeConnectCard {...reg.stripe} />
  ) : null;

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

  const shows_saved = !!reg.o_bank_id && !is_changing;
  // the form that held focus is gone once the saved panel replaces it; a
  // saved bank there on arrival is not a change, so focus stays put
  const saved_heading = useRef<HTMLHeadingElement>(null);
  const showed_saved = useRef(shows_saved);
  useEffect(() => {
    if (shows_saved && !showed_saved.current) saved_heading.current?.focus();
    showed_saved.current = shows_saved;
  }, [shows_saved]);

  if (shows_saved) {
    return (
      <div className="grid gap-6 content-start">
        <section aria-labelledby={heading_id} className="grid gap-3">
          <div className="flex items-center gap-2">
            <h2
              id={heading_id}
              ref={saved_heading}
              tabIndex={-1}
              className="text-xl"
            >
              Your bank payout
            </h2>
            <Badge tone="success">Saved</Badge>
          </div>
          <p className="text-sm text-gray-11">
            Grants are sent to this account through Wise, a money-transfer
            service, every 3 days once your balance reaches your payout minimum.
          </p>
          <dl className="grid gap-0.5 mt-2 text-sm">
            <dt className="font-semibold">Bank account reference</dt>
            <dd className="text-gray-11">{reg.o_bank_id}</dd>
            <dd className="text-xs text-gray-11">
              Wise's reference for the account you entered.
            </dd>
          </dl>
          <ExtLink
            href={reg.o_bank_statement}
            className="flex items-center gap-2 link justify-self-start text-sm"
          >
            <SquareArrowOutUpRight className="icon-md" />
            <span>View bank statement</span>
          </ExtLink>
          <button
            className="btn btn-secondary btn-sm justify-self-start"
            type="button"
            onClick={() => set_is_changing(true)}
          >
            Change bank details
          </button>
        </section>

        {payout_options}
        {stripe_card}

        <Actions>
          <NavLink to={`../${back}`} className="min-w-32 btn btn-secondary">
            Back
          </NavLink>
          <NavLink
            to={`../${steps.summary}`}
            className="min-w-32 btn btn-primary"
          >
            Continue
          </NavLink>
        </Actions>
      </div>
    );
  }

  return (
    <div className="grid gap-6 content-start">
      <section aria-labelledby={heading_id} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id={heading_id} className="text-xl">
              {is_changing ? "Update" : "Set up"} your bank payout
            </h2>
            <Badge tone="primary">Required</Badge>
          </div>
          {is_changing && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => set_is_changing(false)}
            >
              Cancel
            </button>
          )}
        </div>
        <p className="text-sm text-gray-11">
          Grants are sent to this account through Wise, a money-transfer
          service, in the currency you choose. Every kind of donation can pay
          out here, every 3 days once your balance reaches your payout minimum.
        </p>
        {offers_stripe && !reg.o_stripe_account_id && (
          <p className="text-sm text-gray-11">
            Stripe is optional. You can connect it right after your bank details
            are saved.
          </p>
        )}
      </section>

      {payout_options}
      {/* stripe follows a saved bank, unless an account is already linked */}
      {offers_stripe && reg.o_stripe_account_id && stripe_card}

      <BankDetails
        verified
        FormButtons={FormButtons}
        onSubmit={submit}
        is_loading={fetcher.state !== "idle"}
      />
    </div>
  );
}
