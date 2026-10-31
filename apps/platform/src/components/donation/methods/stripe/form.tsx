import {
  Combo,
  Form as FieldSet,
  type IPrompt,
  Prompt,
} from "@better-giving/ui";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { href } from "react-router";
import use_swr from "swr/immutable";
import { currency_precision } from "#/helpers/stripe";
import type { ICurrenciesFv } from "#/types/currency";
import { ru } from "@/helpers/decimal";
import { json_ok } from "@/helpers/https";
import { btn_disp, TokenField } from "../../../token-field";
import { usd_option } from "../../common/constants";
import { CpfToggle } from "../../common/cpf-toggle";
import {
  Frequency,
  freqs_shown,
  opening_frequency,
} from "../../common/frequency";
import { Incrementers } from "../../common/incrementers";
import type { IDonationDest } from "../../common/return-url";
import { StuckMsg, stuck_prompt } from "../../common/stuck-prompt";
import { TipField } from "../../common/tip-field";
import { tip_handlers } from "../../common/tip-handlers";
import { use_donation } from "../../context";
import { pin_bar } from "../../pin";
import { type TMethodState, to_step } from "../../types";
import { use_pay_hold } from "../../use-pay-hold";
import { Paypal } from "../paypal";
import { preferred_currency_apply } from "../preferred-currency";
import { ExpressCheckout } from "./express-checkout";
import { use_rhf } from "./use-rhf";

interface IUnavailable {
  /** the flow shape the rail reported unavailable for */
  flow: string;
  /** what to tell the donor in the block's place */
  msg: string;
}

export function Form(props: TMethodState<"stripe">) {
  const [prompt, set_prompt] = useState<IPrompt>();
  // the paypal flow shape reported unavailable, if any, and why. keyed by flow
  // rather than a boolean so switching currency or frequency re-offers the
  // block instead of hiding it for the rest of the mount.
  const [pp_unavailable, set_pp_unavailable] = useState<IUnavailable>();
  // same for the stripe rail, tracked separately: the two rails fail
  // independently (paypal adblocked while apple/google pay is fine, or the
  // reverse), so one going quiet must never take the other down with it.
  const [sx_unavailable, set_sx_unavailable] = useState<IUnavailable>();
  // a donation on one of the express rails went through. set when the charge
  // lands, not when the trip to the receipt is declared lost: between the two
  // is up to nine seconds of a form that looks exactly like one nothing
  // happened on, and every way to pay is shut for all of it. deliberately not
  // a destination — the click gate only refuses to *open* a rail, so a session
  // the donor already had open can still land after this, and two charges
  // would fight over one variable.
  const [paid, set_paid] = useState(false);
  // ...and where the one whose trip never happened ended up. carried per
  // failure rather than shared with `paid`, so the way out always points at
  // the donation that actually needs it. the prompt saying so can be
  // dismissed, so it has to survive on the form too.
  const [stuck, set_stuck] = useState<IDonationDest>();
  // paypal answered a capture with a status nobody can read, so the money may
  // still move. shuts every rail the way `paid` does, but is kept apart from
  // it: there is no receipt to point at, and the notice says something else.
  const [unconfirmed, set_unconfirmed] = useState(false);
  // shut until a wallet draws, then one frame at full height still invisible,
  // then the fade. height is never transitioned: the card button must not move.
  const [wallet_phase, set_wallet_phase] = useState<{
    flow: string;
    phase: "shut" | "in" | "open";
  }>({ flow: "", phase: "shut" });
  const shut = paid || unconfirmed;
  use_pay_hold(shut);
  const { don_set, don } = use_donation();

  const on_stuck = (dest: IDonationDest) => {
    set_stuck(dest);
    set_prompt(stuck_prompt(dest));
  };

  const fv = props.fv || {
    amount: don.config?.prefill_amount_usd || "",
    currency: usd_option,
    frequency: opening_frequency(
      don.config?.freq_opts,
      don.config?.prefill_frequency
    ),
    tip: "",
    cover_processing_fee: false,
    tip_format: "none",
  };

  const rhf = use_rhf(fv);
  // the amount this mount opened with. a later currencies response must not
  // treat a number the donor typed, or one already in another currency, as
  // dollars.
  const seed_amount = useRef(fv.amount);

  const tip = tip_handlers({
    format: rhf.tip_format,
    set_value: (v) => rhf.setValue("tip", v),
    set_focus: () => rhf.setFocus("tip"),
    str: (pct) => {
      const [c, amnt] = rhf.getValues(["currency", "amount"]);
      if (!amnt) return "";
      return ru((pct / 100) * +amnt, currency_precision(c.code));
    },
  });

  const currency = use_swr(
    href("/api/currencies"),
    (path) => fetch(path).then((res) => json_ok<ICurrenciesFv>(res)),
    {
      shouldRetryOnError: false,
      // also runs when a remount reads the cached response, which is what
      // coming back to this step does.
      onSuccess: (data) => {
        if (!data.pref) return;
        const [current, amount] = rhf.getValues(["currency", "amount"]);
        const next = preferred_currency_apply(
          current,
          amount,
          seed_amount.current,
          data.pref
        );
        if (!next) return;
        rhf.currency.onChange(next.currency);
        rhf.amount.onChange(next.amount);
      },
    }
  );
  const opts = currency.data?.all || [usd_option];

  const freqs = freqs_shown(don.config?.freq_opts);

  const pp_flow = rhf.paypal_express
    ? `${rhf.paypal_express.currency}-${rhf.paypal_express.frequency}`
    : "";

  const sx_flow = rhf.stripe_express
    ? `${rhf.stripe_express.currency}-${rhf.stripe_express.frequency}`
    : "";

  const wallets_below = don.wallets_below === true;
  const pin = don.pin === true;
  // pin stacks the rails under the card button the same way wallets_below does.
  // unset mounts keep `wallets_below` as the only signal.
  const stack_wallets = wallets_below || pin;
  // both rails reload on a currency change or when the gift crosses between
  // one-time and recurring. monthly and annual share one paypal effect and
  // one stripe elements mode, and neither calls on_shown again, so the raw
  // frequency must not collapse a button that is still mounted.
  const rail_load = (currency: string, frequency: string) =>
    `${currency}-${frequency === "one-time" ? "one-time" : "recurring"}`;
  const wallet_flow = [
    rhf.stripe_express
      ? rail_load(rhf.stripe_express.currency, rhf.stripe_express.frequency)
      : "",
    rhf.paypal_express
      ? rail_load(rhf.paypal_express.currency, rhf.paypal_express.frequency)
      : "",
  ].join("|");
  const wallets_below_ref = useRef(stack_wallets);
  wallets_below_ref.current = stack_wallets;
  const wallet_flow_ref = useRef(wallet_flow);
  wallet_flow_ref.current = wallet_flow;
  const phase = wallet_phase.flow === wallet_flow ? wallet_phase.phase : "shut";

  const reveal_wallets = () => {
    if (!wallets_below_ref.current) return;
    const flow = wallet_flow_ref.current;
    set_wallet_phase((s) =>
      s.flow === flow && s.phase !== "shut" ? s : { flow, phase: "in" }
    );
  };

  useEffect(() => {
    if (phase !== "in") return;
    const flow = wallet_flow;
    const id = requestAnimationFrame(() => {
      set_wallet_phase((s) =>
        s.flow === flow && s.phase === "in" ? { flow, phase: "open" } : s
      );
    });
    return () => cancelAnimationFrame(id);
  }, [phase, wallet_flow]);

  /**
   * what stands where an express block would have been. a rail that can't be
   * offered is never a modal: the failure is usually persistent (an adblocked
   * sdk fails the same way on every retry), and a prompt unmounts the rail,
   * whose remount re-fails and re-prompts — on /donate/:id that leaves the
   * donor unable to reach the other tabs. where nobody came to donate, it just
   * isn't offered; where they did, say so quietly and leave the page alone.
   */
  const unavailable = (u: IUnavailable | undefined, flow: string) => {
    if (u?.flow !== flow) return null;
    if (don.hide_unavailable_express) return null;
    return (
      <p role="status" className="text-xs text-gray-11">
        {u.msg}
      </p>
    );
  };

  // the popup portals to body, out of #donation-container, so it inherits none
  // of the tenant palette — re-apply on the far side what the shell reads.
  // --secondary/-active are the option row's highlight and checked fill, one
  // value for both because a tenant hands over a single colour and there is no
  // runtime ramp to press it up a step. --ring is the scrollbar thumb, and
  // #donation-container points it at --form-primary for the same reason.
  const popup_vars: Record<string, string | undefined> = {
    "--form-primary": don.config?.accent_primary,
    "--form-secondary": don.config?.accent_secondary,
    "--secondary": don.config?.accent_secondary,
    "--secondary-active": don.config?.accent_secondary,
    "--ring": don.config?.accent_primary,
  };

  const combobox = (
    <Combo
      classes={{
        container: "has-placeholder-shown:w-34 w-22",
        // the box is TokenField's: this is the left cell of the
        // field-input-container it shares with the amount input, and the focus
        // ring is that container's too (`:has(input:focus)`) — a field box here
        // would draw a second one inside it.
        input: "w-full text-sm bg-transparent px-4 py-3.5 focus:outline-hidden",
      }}
      disabled={currency.isLoading || currency.isValidating}
      adornment={(open) => btn_disp(open, undefined)}
      item_key={(t) => t.code}
      item_text={(t) => t.code}
      placeholder="Currency"
      options={opts}
      // the control is as narrow as a currency code; the list is not
      popup_width="w-56"
      indicator={<CheckIcon className="text-gray-11 icon-sm" />}
      popup_vars={popup_vars}
      value={rhf.currency.value}
      // the schema has no empty currency, and the seam only emits undefined
      // from a clear trigger this control doesn't offer
      on_change={(t) => {
        if (t) rhf.currency.onChange(t);
      }}
    />
  );

  const express_slot =
    rhf.stripe_express && sx_unavailable?.flow !== sx_flow ? (
      <ExpressCheckout
        paid={shut}
        on_error={(msg) =>
          set_prompt({ type: "error", children: <p>{msg}</p> })
        }
        on_paid={() => set_paid(true)}
        on_stuck={on_stuck}
        on_shown={reveal_wallets}
        // nothing has been paid yet and no donor action is pending: record
        // it and let `unavailable` decide what stands in the block's place.
        // never a prompt — see the note there.
        on_unavailable={(msg) => set_sx_unavailable({ flow: sx_flow, msg })}
        validate={async () => {
          const valid = await rhf.trigger(["amount", "frequency"]);
          if (!valid) rhf.setFocus("amount");
          return valid;
        }}
        classes={
          stack_wallets
            ? shut
              ? "opacity-50"
              : ""
            : `mt-4 ${shut ? "opacity-50" : ""}`
        }
        {...rhf.stripe_express}
      />
    ) : null;
  const paypal_slot =
    rhf.paypal_express && pp_unavailable?.flow !== pp_flow ? (
      <Paypal
        {...rhf.paypal_express}
        classes={shut ? "opacity-50" : ""}
        paid={shut}
        validate={async () => {
          const valid = await rhf.trigger(["amount", "frequency"]);
          if (!valid) rhf.setFocus("amount");
          return valid;
        }}
        on_error={(x) => set_prompt({ type: "error", children: x })}
        on_paid={() => set_paid(true)}
        on_shown={reveal_wallets}
        on_stuck={on_stuck}
        on_unconfirmed={() => set_unconfirmed(true)}
        on_unavailable={(msg) => set_pp_unavailable({ flow: pp_flow, msg })}
      />
    ) : null;
  const notices = (
    <div
      className={
        pin
          ? "flex flex-col gap-1 empty:hidden"
          : wallets_below
            ? "mt-4 flex flex-col gap-1 empty:hidden"
            : "mb-2 flex flex-col gap-1 empty:hidden"
      }
    >
      {!prompt && unavailable(sx_unavailable, sx_flow)}
      {!prompt && unavailable(pp_unavailable, pp_flow)}
    </div>
  );
  const continue_btn = (
    <button
      disabled={
        shut || currency.isLoading || currency.isValidating || rhf.isSubmitting
      }
      className={`${stack_wallets ? "" : "mt-auto "}btn btn-form-primary min-h-11`}
      type="submit"
    >
      Continue with Card
    </button>
  );

  const on_submit = rhf.handleSubmit((fv) =>
    to_step("stripe", fv, "donor", don_set)
  );

  const fields = (
    <>
      {freqs && (
        <Frequency
          opts={freqs}
          value={rhf.frequency.value}
          onChange={rhf.frequency.onChange}
          error={rhf.errors.frequency?.message}
        />
      )}
      <TokenField
        ref={rhf.amount.ref}
        combobox={combobox}
        amount={rhf.amount.value}
        amount_usd={
          rhf.currency.value.code === "USD"
            ? 0
            : +rhf.amount.value / rhf.currency.value.rate
        }
        on_change={(x) => {
          rhf.amount.onChange(x);
          if (rhf.errors.amount) rhf.trigger("amount");
        }}
        error={rhf.errors.amount?.message}
        label="Donation amount"
      />
      {rhf.currency.value.rate ? (
        <Incrementers
          classes="-mt-1"
          disabled={currency.isLoading || currency.isValidating}
          on_increment={rhf.on_increment}
          code={rhf.currency.value.code}
          rate={rhf.currency.value.rate}
          increments={don.config?.increments}
          precision={0}
        />
      ) : null}

      {don.recipient.hide_bg_tip ? null : (
        <TipField
          classes="mt-2"
          nudge={!!rhf.amount.value}
          checked={rhf.tip_format.value !== "none"}
          checked_changed={tip.checked_changed}
          tip_format={rhf.tip_format.value}
          tip_format_changed={tip.tip_format_changed}
          custom_tip={
            rhf.tip_format.value === "custom" ? (
              <div className="relative w-full flex items-baseline">
                <span className="font-bold text-xs self-baseline text-form-primary">
                  {rhf.currency.value.code}
                </span>
                <input
                  {...rhf.register("tip")}
                  inputMode="decimal"
                  className="w-full text-sm pl-1 focus:outline-none"
                  placeholder="Enter contribution amount"
                  aria-invalid={!!rhf.errors.tip?.message}
                />
                <span className="right-6 text-xs text-destructive-subtle-fg text-right absolute top-1/2 -translate-y-1/2 empty:hidden">
                  {rhf.errors.tip?.message}
                </span>
              </div>
            ) : undefined
          }
        />
      )}

      <CpfToggle
        classes="mt-1 mb-4"
        checked={rhf.cpf.value}
        checked_changed={(x) => rhf.cpf.onChange(x)}
      />
    </>
  );

  const after_rails = (
    <>
      {stuck && <StuckMsg dest={stuck} classes="mt-4 text-sm text-gray-11" />}
      {/* rendered empty from mount so the notice lands as a change to announce.
          sr-only while empty rather than hidden: it takes no gap in the column
          and stays in the accessibility tree. */}
      <p
        role="status"
        className={unconfirmed ? "mt-4 text-sm text-gray-11" : "sr-only"}
      >
        {unconfirmed &&
          "We couldn't confirm your payment yet. Please don't pay again. Check your email for a receipt, or contact us."}
      </p>
    </>
  );

  if (!pin) {
    return (
      <FieldSet onSubmit={on_submit} className="flex flex-col h-full gap-y-2">
        {fields}
        {/* nothing here unmounts a rail to stop it being used: a prompt raised
            mid-payment, or a `paid` that lands while the donor's sheet is still
            closing, would take the wallet element and its <Elements> wrapper —
            or paypal's live session — out from under them. both rails refuse a
            second payment at their own click gate instead, where the sheet has
            not opened yet and there is nothing to strand. */}
        {wallets_below ? null : express_slot}
        {wallets_below ? null : paypal_slot}
        {wallets_below ? null : notices}
        {after_rails}
        {continue_btn}
        {wallets_below && (
          // the whole group, divider included, adds nothing until a wallet
          // draws. -mt-2 cancels this column's gap either way, so the button
          // never shifts and the divider's own margin is the space. the fade
          // names no duration: the house default is --duration-fast (150ms),
          // and a raw duration number is rejected by the motion gate.
          <div
            data-testid="wallet-group"
            inert={phase === "shut"}
            className={
              phase === "shut"
                ? "h-0 -mt-2 overflow-hidden opacity-0"
                : `-mt-2 flex flex-col transition-opacity ${
                    phase === "open" ? "opacity-100" : "opacity-0"
                  }`
            }
          >
            <p className="my-4 text-center text-xs text-gray-11">or</p>
            <div className="flex flex-col gap-2">
              {express_slot}
              {paypal_slot}
            </div>
            {notices}
          </div>
        )}
        {prompt && <Prompt {...prompt} onClose={() => set_prompt(undefined)} />}
      </FieldSet>
    );
  }

  return (
    <FieldSet onSubmit={on_submit} className="flex min-h-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-y-2 p-5 sm:p-6">
        {fields}
        {after_rails}
      </div>
      <div data-pin="" className={pin_bar}>
        {continue_btn}
        <div
          data-testid="wallet-group"
          inert={phase === "shut"}
          className={
            phase === "shut"
              ? "h-0 -mt-3 overflow-hidden opacity-0"
              : "flex flex-col gap-3"
          }
        >
          <p className="text-center text-sm text-gray-11">or</p>
          {express_slot}
          {paypal_slot}
          {notices}
        </div>
      </div>
      {prompt && <Prompt {...prompt} onClose={() => set_prompt(undefined)} />}
    </FieldSet>
  );
}
