import { Actions, ExtLink, use_ask_prompt } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useFetcher } from "react-router";
import { BankDetails, type OnSubmit } from "#/components/bank-details";
import { StripeConnectCard } from "#/components/stripe-connect/connect-card";
import { submit_error_prompt } from "#/helpers/error-prompt";
import { use_strip_connect_params } from "#/hooks/use-strip-connect-params";
import { step_loader } from "#/pages/registration/data/step-loader";
import { before_banking, next_step, steps } from "#/pages/registration/routes";
import { update_action } from "#/pages/registration/update-action";
import type { TRegUpdate } from "@/reg";
import {
  connect_notice,
  connect_start_href,
  type IConnectCardData,
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
  const stripe: IConnectCardData = {
    status:
      connect_routing && acct
        ? await account_status_live(acct)
        : "not_connected",
    start_href: connect_start_href({ kind: "reg", reg_id: reg.id }),
    ...(connect_routing && {
      notice: connect_notice(args.url),
    }),
  };
  return { ...reg, stripe, connect_routing };
};
export const action = update_action(next_step[4]);

export default function Page({ loaderData: reg }: Route.ComponentProps) {
  const [is_changing, set_is_changing] = useState(false);
  const fetcher = useFetcher();
  const ask_prompt = use_ask_prompt();
  const back = before_banking(reg.o_type);
  // stable identity — BankDetails renders it as a component
  const FormButtons = useMemo(() => form_buttons(back), [back]);
  use_strip_connect_params(reg.connect_routing && !!reg.stripe.notice);
  const stripe_card = reg.connect_routing ? (
    <StripeConnectCard {...reg.stripe} classes="self-stretch mb-8" />
  ) : null;

  const submit: OnSubmit = async (recipient, bank_statement) => {
    const update: TRegUpdate = {
      update_type: "banking",
      o_bank_statement: bank_statement,
      o_bank_id: recipient.id.toString(),
    };
    fetcher.submit(update, {
      method: "PATCH",
      encType: "application/json",
    });
  };

  // a rejected update resolves the submit instead of throwing: the action
  // returns a tagged failure (`resp.fail`) the client reads off `fetcher.data`,
  // while a landed save redirects and never lands here.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    ask_prompt(
      submit_error_prompt(fetcher.data, {
        context: "saving your banking details",
      }),
      { key: "reg-banking-submit-error" }
    );
  }, [fetcher.state, fetcher.data, ask_prompt]);

  if (reg.o_bank_id && !is_changing) {
    return (
      <div className="flex flex-col items-start max-sm:items-center">
        {stripe_card}
        <h2 className="text-center sm:text-left text-xl mb-2">
          Banking details
        </h2>

        <p className="mt-6 mb-1 first-letter:uppercase">
          <span className="text-sm font-semibold">account id: </span>
          <span className="text-gray-11 ">{reg.o_bank_id}</span>
        </p>
        <ExtLink
          href={reg.o_bank_statement}
          className="flex items-center gap-2 link"
        >
          <SquareArrowOutUpRight className="icon-md" />
          <span>Bank statement</span>
        </ExtLink>
        <button
          className="btn btn-sm btn-destructive mt-2 mb-8"
          type="button"
          onClick={() => set_is_changing(true)}
        >
          change
        </button>

        <Actions classes="mt-auto">
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
    <div className="flex flex-col items-start max-sm:items-center">
      {stripe_card}
      {is_changing && (
        <button
          className="btn btn-sm btn-primary mt-2 mb-4"
          type="button"
          onClick={() => set_is_changing(false)}
        >
          cancel
        </button>
      )}
      <h2 className="text-center sm:text-left text-xl mb-4">
        {is_changing ? "Update" : "Setup"} your banking details
      </h2>
      <BankDetails
        verified
        FormButtons={FormButtons}
        onSubmit={submit}
        is_loading={fetcher.state !== "idle"}
      />
    </div>
  );
}
