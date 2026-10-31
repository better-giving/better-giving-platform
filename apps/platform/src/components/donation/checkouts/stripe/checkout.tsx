import { ErrorStatus } from "@better-giving/ui";
import text_700 from "@better-giving/ui/fonts/RedHatRoundText-Bold.woff2?url";
import text_500 from "@better-giving/ui/fonts/RedHatRoundText-Medium.woff2?url";
import text_400 from "@better-giving/ui/fonts/RedHatRoundText-Regular.woff2?url";
import text_600 from "@better-giving/ui/fonts/RedHatRoundText-SemiBold.woff2?url";
import { Elements } from "@stripe/react-stripe-js";
import type { CustomFontSource } from "@stripe/stripe-js";
import { href } from "react-router";
import use_swr from "swr/immutable";
import { report_error } from "#/errors/report";
import type { IDonationIntent, IStripeIntentReturn } from "@/donations";
import { HttpError, json_ok } from "@/helpers/https";
import { ErrorBoundaryClass } from "../../../error";
import { apply_campaign } from "../../apply-campaign";
import { stripe_amounts } from "../../common/amounts";
import { currency as currencyfn } from "../../common/currency";
import { stripe_promise } from "../../common/stripe";
import { Summary } from "../../common/summary";
import { use_donation } from "../../context";
import { type StripeDonationDetails, to_step } from "../../types";
import { DonationTerms } from "../donation-terms";
import { Loader } from "../loader";
import { Checkout } from "./checkout-form";

const fetcher = async (intent: IDonationIntent) =>
  fetch(href("/api/donation-intents"), {
    method: "POST",
    body: JSON.stringify(intent),
  }).then((res) => json_ok<IStripeIntentReturn>(res));

// stripe elements renders in a cross-origin iframe that cannot see our
// @font-face rules, so the body face is handed over as font files. vite's url
// is the blob asset origin on deployed stages (vite.config.ts → asset_base)
// and root-relative locally; stripe only fetches https fonts, so the local
// http url is skipped and dev renders the fallback face. called only once the
// intent has loaded, so never during ssr.
const stripe_fonts = (): CustomFontSource[] => {
  const files = [
    [400, text_400],
    [500, text_500],
    [600, text_600],
    [700, text_700],
  ] as const;
  const fonts = files.map(([weight, url]) => ({
    family: "Red Hat Round Text",
    url: new URL(url, window.location.origin),
    weight: String(weight),
  }));
  if (fonts.some((f) => f.url.protocol !== "https:")) return [];
  return fonts.map(({ family, url, weight }) => ({
    family,
    src: `url(${url.href}) format("woff2")`,
    weight,
    style: "normal",
    display: "swap",
  }));
};

interface IStripeCheckoutProps extends StripeDonationDetails {
  bank_only?: boolean;
}

export function StripeCheckout(props: IStripeCheckoutProps) {
  const {
    frequency,
    amount,
    tip,
    tip_format,
    cover_processing_fee,
    currency,
    bank_only,
  } = props;
  const { don, don_set, pay_busy } = use_donation();
  const paying = pay_busy === true;

  const parts = stripe_amounts({
    amount: +amount,
    tip_format,
    tip,
    cover_processing_fee,
    currency,
    bank_only,
  });

  const intent: IDonationIntent = {
    via: bank_only ? "bank" : "card",
    via_extra: "",
    frequency: frequency,
    amount: parts,
    currency: currency.code,
    to_id: don.recipient.id,
    donor: don.donor,
    source: don.source,
  };

  if (don.program) intent.program = don.program;
  if (don.config?.id) intent.form_id = don.config.id;
  apply_campaign(intent, don.config);

  // each request creates a donation row and a stripe intent
  const { data, error, isLoading } = use_swr(intent, fetcher, {
    shouldRetryOnError: false,
    // wrapped: swr's second arg is the key — the donor's intent — which
    // `report_error` would send along as context
    onError: (e) => report_error(e),
  });

  return (
    <Summary
      classes={
        don.pin
          ? "flex min-h-full flex-1 flex-col px-5 pt-5 sm:px-6 sm:pt-6"
          : "grid content-start p-4 @xl/steps:p-8"
      }
      // leaving unmounts the hold, which unlocks the dialog while the bank
      // check is still out
      on_back={() => {
        if (paying) return;
        to_step(bank_only ? "stripe_bank" : "stripe", props, "donor", don_set);
      }}
      back_disabled={paying}
      Amount={currencyfn(currency)}
      amount={parts.base}
      fee_allowance={parts.fee_allowance}
      frequency={frequency}
      tip={
        parts.tip > 0
          ? { value: parts.tip, charity_name: don.recipient.name }
          : undefined
      }
    >
      <ErrorBoundaryClass>
        {isLoading ? (
          <Loader msg="Loading payment form.." />
        ) : error || !data ? (
          <ErrorStatus>
            {error instanceof HttpError && error.refused
              ? error.message
              : "We couldn't start the payment. Please try again or choose a different payment method."}
          </ErrorStatus>
        ) : (
          <Elements
            options={{
              fonts: stripe_fonts(),
              clientSecret: data.client_secret,
              appearance: {
                theme: "flat",
                variables: {
                  colorPrimary: don.config?.accent_primary,
                  fontFamily: '"Red Hat Round Text", sans-serif',
                  borderRadius: "4px",
                  gridRowSpacing: "20px",
                },
              },
            }}
            stripe={stripe_promise}
          >
            <Checkout
              {...intent}
              order_id={data.order_id}
              bank_only={bank_only}
            />
          </Elements>
        )}
      </ErrorBoundaryClass>
      <DonationTerms endowName={don.recipient.name} classes="mt-5" />
    </Summary>
  );
}
