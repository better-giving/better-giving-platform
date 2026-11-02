import { Breadcrumb, use_ask_prompt } from "@better-giving/ui";
import { useEffect } from "react";
import { href, useFetcher } from "react-router";
import { BankDetails } from "#/components/bank-details";
import { submit_error_prompt } from "#/helpers/error-prompt";
import { FormButtons } from "./form-buttons";

export { ErrorBoundary } from "#/components/error";
export { action } from "./api";

export default function Payout() {
  const fetcher = useFetcher();
  const ask_prompt = use_ask_prompt();

  // a rejected save resolves the submit instead of throwing: the action
  // returns a tagged failure (`resp.fail`) the client reads off `fetcher.data`,
  // while a landed save redirects and never lands here.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    ask_prompt(
      submit_error_prompt(fetcher.data, {
        context: "saving your payout account",
      }),
      { key: "payout-submit-error" }
    );
  }, [fetcher.state, fetcher.data, ask_prompt]);

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-4"
        items={[
          { label: "My referrals", to: href("/dashboard/referrals") },
          { label: "Payout account" },
        ]}
      />
      <BankDetails
        FormButtons={FormButtons}
        onSubmit={async ({ id, bg_grant }) =>
          fetcher.submit(
            // the grant the wise proxy stamped when it minted this recipient —
            // the action stores no id without it
            JSON.stringify({ id, grant: bg_grant }),
            { method: "POST", encType: "application/json" }
          )
        }
        is_loading={fetcher.state !== "idle"}
      />
    </div>
  );
}
