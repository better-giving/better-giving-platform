import { Breadcrumb, Group, use_ask_prompt } from "@better-giving/ui";
import { useEffect } from "react";
import type { MetaFunction } from "react-router";
import { href, useFetcher, useParams } from "react-router";
import { BankDetails, type OnSubmit } from "#/components/bank-details";
import { submit_error_prompt } from "#/helpers/error-prompt";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { FormButtons } from "./form-buttons";

export { ErrorBoundary } from "#/components/error";
export { action } from "./api";

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Bank account details", matches);

export default function Banking() {
  const { id: endowIdParam = "" } = useParams();
  const fetcher = useFetcher();
  const ask_prompt = use_ask_prompt();

  const submit: OnSubmit = async (recipient, bankStatementUrl) => {
    const { id, details, currency } = recipient;
    //creating account return V1Recipient and doesn't have longAccount summary field
    const bankSummary = `${currency.toUpperCase()} account ending in ${
      details.accountNumber?.slice(-4) || "0000"
    } `;

    fetcher.submit(
      {
        wiseRecipientID: id.toString(),
        bankSummary,
        endowmentID: +endowIdParam,
        bankStatementFile: {
          name: bankStatementUrl,
          publicUrl: bankStatementUrl,
        },
      },
      { action: ".", method: "POST", encType: "application/json" }
    );
  };

  // a rejected submit resolves instead of throwing: the action returns a tagged
  // failure (`resp.fail`) the client reads off `fetcher.data`, while a landed
  // one redirects and never lands here.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    ask_prompt(
      submit_error_prompt(fetcher.data, {
        context: "submitting banking application",
      }),
      { key: "banking-submit-error" }
    );
  }, [fetcher.state, fetcher.data, ask_prompt]);

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-4"
        items={[
          {
            label: "Banking",
            to: href("/admin/:id/banking", { id: endowIdParam }),
          },
          { label: "Add bank account" },
        ]}
      />
      <Group
        classes="max-w-[1112px]"
        title="Bank account details"
        description="The following information will be used to register your bank account that will be used to withdraw your funds."
      >
        <BankDetails
          verified
          FormButtons={FormButtons}
          onSubmit={submit}
          is_loading={fetcher.state !== "idle"}
        />
      </Group>
    </div>
  );
}
