import { ContentLoader, use_ask_prompt } from "@better-giving/ui";
import { useEffect, useRef, useState } from "react";
import { href } from "react-router";
import { chariot_connect_id } from "#/constants/env";
import { error_prompt, user_error_prompt } from "#/helpers/error-prompt";
import { currency_precision, to_atomic } from "#/helpers/stripe";
import { PROCESSING_RATES } from "@/constants/common";
import type { ChariotMetadata } from "@/donations";
import { partition } from "@/donations/helpers";
import type {
  IAmount,
  IDonationIntent,
  IDonorAddress,
} from "@/donations/schema";
import { to_units } from "@/helpers/decimal";
import { HttpError, json_ok } from "@/helpers/https";
import { apply_campaign } from "../../apply-campaign";
import { donation_amounts } from "../../common/amounts";
import { usd_option } from "../../common/constants";
import { currency } from "../../common/currency";
import { use_donation_redirect } from "../../common/redirect";
import {
  donation_return_url,
  type IDonationDest,
} from "../../common/return-url";
import { StuckMsg, stuck_prompt } from "../../common/stuck-prompt";
import { Summary } from "../../common/summary";
import { use_donation } from "../../context";
import { type DafDonationDetails, tip_from_val, to_step } from "../../types";
import { use_pay_hold } from "../../use-pay-hold";
import { DonationTerms } from "../donation-terms";

const CDN_SRC = "https://cdn.givechariot.com/chariot-connect.umd.js";
/**
 * one prompt slot for the whole checkout, so "processing payment" becomes the
 * stuck message or the error in place rather than gaining a dialog on top of
 * it — the non-dismissable loading prompt never resolves on its own.
 */
const PROMPT_SLOT = "daf-checkout";
/**
 * what `/api/donation-intents` answers when no grant was made: the schema,
 * minimum and whole-dollar refusals (400), a closed recipient (404), and create
 * grant's own refusals passed through (400, 404, an expired session's 410).
 * nothing exists at chariot, so the donor can go again. any other 4xx (a waf
 * block, a rate limit), or one of these without the route's refusal marker,
 * isn't the route's and says nothing about the grant.
 */
const PRE_GRANT_REFUSALS = new Set([400, 404, 410]);

/** dafs grant whole dollars only: the total rounds up to the next dollar, the
 * difference landing on the fee allowance when the donor covers fees, else on
 * the tip. with neither, the base is the total as entered. */
function whole_dollar_amounts({ base, tip, fee_allowance }: IAmount): IAmount {
  if (!tip && !fee_allowance) return { base, tip, fee_allowance };
  const cents = (x: number) => to_units(x, 2);
  const total = cents(base) + cents(tip) + cents(fee_allowance);
  const topup = Math.ceil(total / 100) * 100 - total;
  return fee_allowance
    ? { base, tip, fee_allowance: (cents(fee_allowance) + topup) / 100 }
    : { base, tip: (cents(tip) + topup) / 100, fee_allowance };
}

/** `grant_cents` split in `amount`'s proportions, each part on whole cents and
 * the base taking the rounding so the parts still sum to the grant */
function split_in_cents(amount: IAmount, grant_cents: number): IAmount {
  const scaled = partition(amount)(grant_cents);
  const tip = Math.round(scaled.tip);
  const fee_allowance = Math.round(scaled.fee_allowance);
  return {
    base: (grant_cents - tip - fee_allowance) / 100,
    tip: tip / 100,
    fee_allowance: fee_allowance / 100,
  };
}

export function ChariotCheckout(props: DafDonationDetails) {
  const { don_set, don, pay_busy } = use_donation();
  const paying = pay_busy === true;
  const ask_prompt = use_ask_prompt();
  // where a grant that has already been recommended ended up. set the moment
  // the money moves, not when the trip to the receipt is declared lost: what
  // comes between is up to nine seconds of a panel that looks exactly like one
  // nothing happened on.
  const [paid, set_paid] = useState<IDonationDest>();
  // ...and the trip never happened, so the way to the receipt has to be on the
  // panel: the prompt carrying it can be dismissed.
  const [stuck, set_stuck] = useState(false);
  // dead from the moment the intent is sent: short of one of the route's own
  // pre-grant refusals, the grant may exist at chariot and a fresh connect
  // session from here would be a second one
  const [sent, set_sent] = useState(false);
  const [script_ready, set_script_ready] = useState(false);
  // sent stays set when the grant may already exist. paid is the trip to the
  // receipt. the dialog stays up for both so a second grant cannot start.
  use_pay_hold(sent || paid != null);

  const { tip: tipv, fee_allowance: mfa } = whole_dollar_amounts(
    donation_amounts(
      {
        amount: +props.amount,
        tip_format: props.tip_format,
        tip: props.tip,
        cover_processing_fee: props.cover_processing_fee,
      },
      currency_precision(usd_option.code),
      { rate: PROCESSING_RATES.chariot }
    )
  );

  // refs for latest values so the chariot element doesn't re-mount on every change
  const props_ref = useRef(props);
  props_ref.current = props;
  const don_ref = useRef(don);
  don_ref.current = don;
  const don_set_ref = useRef(don_set);
  don_set_ref.current = don_set;
  const tipv_ref = useRef(tipv);
  tipv_ref.current = tipv;
  const mfa_ref = useRef(mfa);
  mfa_ref.current = mfa;
  const redirect = use_donation_redirect();
  const redirect_ref = useRef(redirect);
  redirect_ref.current = redirect;

  // load chariot CDN script
  useEffect(() => {
    if (document.querySelector(`script[src="${CDN_SRC}"]`)) {
      set_script_ready(true);
      return;
    }
    const script = document.createElement("script");
    script.src = CDN_SRC;
    script.onload = () => set_script_ready(true);
    document.head.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, []);

  const container_ref = useRef<HTMLDivElement>(null);

  // mount chariot-connect element
  useEffect(() => {
    const container = container_ref.current;
    if (!container || !script_ready) return;

    const el = document.createElement("chariot-connect") as HTMLElement & {
      onDonationRequest: (cb: () => Promise<unknown>) => void;
    };
    el.setAttribute("cid", chariot_connect_id);
    el.setAttribute("theme", "LightBlueTheme");

    const on_donation_request = async () => {
      const p = props_ref.current;
      const tv = tipv_ref.current;
      const fee = mfa_ref.current;
      const total = +p.amount + tv + fee;
      const amnt: IAmount = {
        base: +p.amount,
        tip: tv,
        fee_allowance: fee,
      };
      const metadata = {
        don_id: crypto.randomUUID(),
        amount: amnt,
      } satisfies ChariotMetadata;

      return {
        amount: to_atomic(total, [2, 2]),
        metadata,
      };
    };

    // https://givechariot.readme.io/reference/integrating-connect#pre-populate-data-into-your-connect-session
    const on_init = () => {
      el.onDonationRequest(async () => on_donation_request());
    };
    el.addEventListener("CHARIOT_INIT", on_init);

    // see https://givechariot.readme.io/reference/integrating-connect#capture-your-grant-intent
    const on_success = async (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { grantIntent, workflowSessionId, user: grantor } = detail;
      const m: ChariotMetadata = grantIntent.metadata;
      const d = don_ref.current;

      try {
        // stays up until the browser leaves or the redirect reports it never
        // did — clearing it the moment the intent is recorded would hand the
        // donor a panel that looks untouched while the trip to the receipt is
        // still being attempted.
        ask_prompt(
          {
            type: "loading",
            children: "Processing payment",
            isDismissable: false,
          },
          { key: PROMPT_SLOT }
        );

        /** user may input amount different from our donate form */
        const grant_cents: number = grantIntent.amount;
        const grant_amount = grant_cents / 100;
        const adj = split_in_cents(m.amount, grant_cents);

        //reflect adjustment to state
        don_set_ref.current((x) => ({
          ...x,
          method: "daf",
          daf: {
            type: "daf",
            step: "checkout",
            fv: {
              ...props_ref.current,
              ...tip_from_val(adj.tip, adj.base),
            },
          },
        }));

        const ga = grantor.address;
        const addr: IDonorAddress | undefined = ga && {
          street: [ga.line1, ga.line2].filter(Boolean).join(", "),
          city: ga.city,
          state: ga.state,
          zip_code: ga.postalCode,
        };

        const intent: IDonationIntent = {
          via: "chariot",
          via_extra: workflowSessionId,
          frequency: "one-time",
          currency: usd_option.code,
          amount: adj,
          to_id: d.recipient.id,
          donor: {
            title: "",
            email: grantor.email,
            first_name: grantor.firstName,
            last_name: grantor.lastName,
            company_name: "",
            address: addr,
          },
          source: d.source,
        };

        if (d.program) intent.program = d.program;
        if (d.config?.id) intent.form_id = d.config.id;
        apply_campaign(intent, d.config);

        set_sent(true);
        const res = await fetch(href("/api/donation-intents"), {
          method: "POST",
          body: JSON.stringify(intent),
        });
        const { id } = await json_ok<{ id: string }>(res);

        const dest = donation_return_url({
          donation_id: id,
          base_url: d.base_url,
          success_redirect: d.config?.success_redirect,
          amount: grant_amount,
          currency: usd_option.code,
          payment_method: "daf",
          donor_name: [grantor.firstName, grantor.lastName],
        });

        // the grant is recommended and irreversible from here — every path
        // below is us trying to reach the receipt.
        set_paid(dest);

        redirect_ref.current({
          dest,
          form_id: d.config?.id,
          parent_origin: d.config?.parent_origin,
          on_stuck: () => {
            // the panel keeps saying it after the modal is gone
            set_stuck(true);
            ask_prompt(stuck_prompt(dest), { key: PROMPT_SLOT });
          },
        });
      } catch (err) {
        if (
          err instanceof HttpError &&
          err.refused &&
          PRE_GRANT_REFUSALS.has(err.status)
        ) {
          set_sent(false);
          ask_prompt(user_error_prompt(err.message), { key: PROMPT_SLOT });
          return;
        }
        ask_prompt(error_prompt(err, { context: "processing donation" }), {
          key: PROMPT_SLOT,
        });
      }
    };
    el.addEventListener("CHARIOT_SUCCESS", on_success);

    container.appendChild(el);
    return () => {
      el.removeEventListener("CHARIOT_INIT", on_init);
      el.removeEventListener("CHARIOT_SUCCESS", on_success);
      container.removeChild(el);
    };
  }, [script_ready, ask_prompt]);

  return (
    <Summary
      classes="group grid content-start p-4 @xl/steps:p-8 [&_#connectContainer]:mt-8"
      // leaving unmounts the hold while a grant may already exist
      on_back={() => {
        if (paying) return;
        to_step("daf", props, "form", don_set);
      }}
      back_disabled={paying}
      Amount={currency(usd_option)}
      amount={+props.amount}
      fee_allowance={mfa}
      frequency="one-time"
      tip={tipv ? { value: tipv, charity_name: don.recipient.name } : undefined}
    >
      {/* the grant may be recommended, so the launcher goes dead — one more click
          here is a second real grant, of real money, out of the donor's fund.
          it goes dead in place rather than away: chariot's element owns a
          session whose modal renders into `document.body`, so unmounting it is
          the one move that could strand a sheet the donor still has open.
          `inert` shuts out pointer and keyboard both, and reaches into the
          shadow root the button lives in — `pointer-events-none` would leave
          it tabbable. */}
      <div
        ref={container_ref}
        inert={sent}
        className={sent ? "opacity-50" : undefined}
      >
        {!script_ready && <ContentLoader className="h-12 mt-4 block" />}
      </div>
      <ContentLoader className="h-12 mt-4 block group-has-[chariot-connect]:hidden" />
      {stuck && paid && (
        <StuckMsg dest={paid} classes="mt-4 text-sm text-gray-11" />
      )}
      <DonationTerms
        endowName={don.recipient.name}
        classes="border-t border-hairline mt-5 pt-4 "
      />
    </Summary>
  );
}
