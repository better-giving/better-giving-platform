import { chains, type IToken, is_custom } from "@better-giving/crypto";
import { Combo } from "@better-giving/ui";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { href } from "react-router";
import { report_error } from "#/errors/report";
import type { ITokenEstimate } from "#/types/api";
import { DONATION_INCREMENTS, logo_url } from "@/constants/common";
import { ru_vdec } from "@/helpers/decimal";
import { btn_disp, TokenField, type TTokenState } from "../../../token-field";
import { init_token_option } from "../../common/constants";
import { CpfToggle } from "../../common/cpf-toggle";
import { Incrementers } from "../../common/incrementers";
import { MethodBenefits } from "../../common/method-benefits";
import { TipField } from "../../common/tip-field";
import { tip_handlers } from "../../common/tip-handlers";
import { use_donation } from "../../context";
import { pin_bar } from "../../pin";
import { type ITokenFv, type TMethodState, to_step } from "../../types";
import { use_rhf } from "./use-rhf";

async function search_tokens(
  q: string,
  signal: AbortSignal
): Promise<IToken[]> {
  const res = await fetch(`${href("/api/tokens")}?q=${encodeURIComponent(q)}`, {
    signal,
  });
  if (!res.ok) throw res;
  return res.json();
}

const ESTIMATE_ERROR =
  "Couldn't get a price for this token. Pick it again or choose another.";

export function Form(props: TMethodState<"crypto">) {
  const { don, don_set } = use_donation();
  const [token_state, set_token_state] = useState<TTokenState>(undefined);

  const {
    handleSubmit,
    isSubmitting,
    reset,
    token,
    errors,
    on_increment,
    tip_format,
    cpf,
    setFocus,
    setValue,
    getValues,
    register,
  } = use_rhf(props.fv);

  const tip = tip_handlers({
    format: tip_format,
    set_value: (v) => setValue("tip", v),
    set_focus: () => setFocus("tip"),
    str: (pct) => {
      const tkn = getValues("token");
      if (!tkn.amount) return "";
      return ru_vdec((pct / 100) * +tkn.amount, tkn.usdpu, tkn.precision);
    },
  });

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
        container: "has-placeholder-shown:w-34 w-24",
        // the box is TokenField's: this is the left cell of the
        // field-input-container it shares with the amount input, and the focus
        // ring is that container's too (`:has(input:focus)`) — a field box here
        // would draw a second one inside it.
        input: "w-full text-sm bg-transparent px-4 py-3.5 focus:outline-hidden",
      }}
      disabled={token_state === "loading"}
      // the state the seam offers is the search's. `token_state` is the
      // estimate that follows a pick — a different fetch, and the one worth an
      // icon: the search has no debounce, so showing it here would strobe the
      // chevron on every keystroke.
      adornment={(open) => btn_disp(open, token_state)}
      item_key={(t) => t.code}
      item_text={(t) => t.symbol}
      placeholder="Select token"
      // /api/tokens is fuzzy over name and network as well as the symbol, so
      // the query is the server's to answer — nothing re-filters what it sends
      options={{ search: search_tokens }}
      // the control is as narrow as a symbol; the list is not
      popup_width="w-56"
      indicator={<CheckIcon className="text-gray-11 icon-sm" />}
      popup_vars={popup_vars}
      render={(t) => (
        <>
          <img
            src={logo_url(t.logo, is_custom(t.id))}
            className="size-6 rounded-full"
            alt=""
          />
          <span className="grid gap-y-0.5 text-xs">
            <span>{t.symbol}</span>
            <span style={{ color: t.color }}>{chains[t.network].name}</span>
          </span>
        </>
      )}
      // the schema has no empty token, and the seam only emits undefined from
      // a clear trigger this control doesn't offer
      value={token.value.code ? token.value : undefined}
      on_change={async (t) => {
        if (!t) return;
        // usdpu/min stay 0 until this token's own estimate lands — the schema
        // rejects a 0 price, so the previous pick's can't pass for a new token
        token.onChange({
          ...init_token_option,
          ...t,
          amount: getValues("token.amount"),
        } satisfies ITokenFv);
        set_token_state("loading");
        try {
          const res = await fetch(
            href("/api/tokens/:code/estimate", { code: t.code })
          );
          if (!res.ok) throw res;
          const { usdpu, min }: ITokenEstimate = await res.json();
          if (!(usdpu > 0)) throw new Error(`no price for ${t.code}`);
          set_token_state(undefined);
          // no stale resolve to drop: the combobox is disabled while this runs.
          // the amount input is not — read it now
          token.onChange({ ...getValues("token"), usdpu, min });
        } catch (err) {
          report_error(err);
          // a combobox emits only on a changed value, so the failed pick is
          // cleared — picking the same token again is what retries
          token.onChange({
            ...init_token_option,
            amount: getValues("token.amount"),
          } satisfies ITokenFv);
          set_token_state("error");
        }
      }}
    />
  );

  const pin = don.pin === true;

  const fields = (
    <>
      <TokenField
        combobox={combobox}
        ref={token.ref}
        amount={token.value.amount}
        amount_usd={token.value.usdpu * +token.value.amount}
        on_change={(x) => token.onChange({ ...token.value, amount: x })}
        error={
          token_state === "error"
            ? ESTIMATE_ERROR
            : errors.token?.amount?.message || errors.token?.id?.message
        }
        label="Donation amount"
      />

      {token.value.code && !token_state && (
        <Incrementers
          classes="-mt-1"
          disabled={token_state === "error" || token_state === "loading"}
          on_increment={on_increment}
          code={token.value.symbol}
          rate={token.value.usdpu}
          precision={token.value.precision}
          increments={(don.config?.increments || DONATION_INCREMENTS).map(
            (i) => {
              const v = +i.value / token.value.usdpu ** 2;
              return { ...i, value: v.toString() };
            }
          )}
        />
      )}

      {don.recipient.hide_bg_tip ? null : (
        <TipField
          classes="mt-2"
          nudge={!!token.value.amount}
          checked={tip_format.value !== "none"}
          checked_changed={tip.checked_changed}
          tip_format={tip_format.value}
          tip_format_changed={tip.tip_format_changed}
          custom_tip={
            tip_format.value === "custom" ? (
              <div className="relative w-full flex items-baseline">
                <span className="font-bold text-xs self-baseline text-form-primary">
                  {token.value.symbol}
                </span>
                <input
                  {...register("tip")}
                  inputMode="decimal"
                  className="w-full text-sm pl-1 focus:outline-none"
                  placeholder="Enter contribution amount"
                  aria-invalid={!!errors.tip?.message}
                />
                <span className="right-6 text-xs text-destructive-subtle-fg text-right absolute top-1/2 -translate-y-1/2 empty:hidden">
                  {errors.tip?.message}
                </span>
              </div>
            ) : undefined
          }
        />
      )}

      <CpfToggle
        classes="mt-1"
        checked={cpf.value}
        checked_changed={(x) => cpf.onChange(x)}
      />
      <MethodBenefits subject="crypto" classes="mt-2" />
    </>
  );

  const continue_btn = (
    <button
      disabled={
        token_state === "error" || token_state === "loading" || isSubmitting
      }
      className={`${pin ? "" : "mt-auto "}btn btn-form-primary`}
      type="submit"
    >
      Continue
    </button>
  );

  const on_submit = handleSubmit((x) => {
    to_step("crypto", x, "donor", don_set);
    reset();
  });

  if (!pin) {
    return (
      <form
        onSubmit={on_submit}
        className="flex flex-col gap-y-2 rounded min-h-full"
        autoComplete="off"
      >
        {fields}
        {continue_btn}
      </form>
    );
  }

  return (
    <form
      onSubmit={on_submit}
      className="flex min-h-full flex-1 flex-col"
      autoComplete="off"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-y-2 p-5 sm:p-6">
        {fields}
      </div>
      <div data-pin="" className={pin_bar}>
        {continue_btn}
      </div>
    </form>
  );
}
