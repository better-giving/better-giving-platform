import type { ITicker } from "@better-giving/stocks";
import { Combo, Form as FormContainer } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { href } from "react-router";
import { report_error } from "#/errors/report";
import type { ITokenEstimate } from "#/types/api";
import { ru_vdec } from "@/helpers/decimal";
import { btn_disp, TokenField, type TTokenState } from "../../../token-field";
import { init_ticker_option } from "../../common/constants";
import { MethodBenefits } from "../../common/method-benefits";
import { TipField } from "../../common/tip-field";
import { tip_handlers } from "../../common/tip-handlers";
import { use_donation } from "../../context";
import { pin_bar } from "../../pin";
import {
  type StocksDonationDetails as FV,
  type ITickerFv,
  stocks_donation_details,
  type TMethodState,
  to_step,
} from "../../types";

async function search_tickers(
  q: string,
  signal: AbortSignal
): Promise<ITicker[]> {
  const res = await fetch(
    `${href("/api/tickers")}?q=${encodeURIComponent(q)}`,
    { signal }
  );
  if (!res.ok) throw res;
  return res.json();
}

const ESTIMATE_ERROR =
  "Couldn't get a price for this stock. Pick it again or choose another.";
const ESTIMATE_PENDING =
  "Getting a price for this stock. Try again in a moment.";

export function Form(props: TMethodState<"stocks">) {
  const [ticker_state, set_ticker_state] = useState<TTokenState>(undefined);
  const [submitted_while_estimating, set_submitted_while_estimating] =
    useState(false);

  const { don_set, don } = use_donation();
  const initial: FV = {
    ticker: init_ticker_option,
    tip: "",
    tip_format: "none",
  };

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    setFocus,
    formState: { isSubmitting, errors },
  } = useForm({
    defaultValues: props.fv || initial,
    criteriaMode: "all",
    resolver: valibotResolver(stocks_donation_details),
  });

  const { field: ticker } = useController<FV, "ticker">({
    control: control,
    name: "ticker",
  });

  const { field: tip_format } = useController({
    name: "tip_format",
    control,
  });

  const tip = tip_handlers({
    format: tip_format,
    set_value: (v) => setValue("tip", v),
    set_focus: () => setFocus("tip"),
    str: (pct) => {
      const amnt = getValues("ticker.amount");
      if (!amnt) return "";
      return ru_vdec((pct / 100) * +amnt, 1);
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
      disabled={ticker_state === "loading"}
      // the state the seam offers is the search's. `ticker_state` is the
      // estimate that follows a pick — a different fetch, and the one worth an
      // icon: the search has no debounce, so showing it here would strobe the
      // chevron on every keystroke.
      adornment={(open) => btn_disp(open, ticker_state)}
      item_key={(t) => t.symbol}
      item_text={(t) => t.symbol}
      placeholder="Select ticker"
      // /api/tickers is fuzzy over the company name as well as the symbol, so
      // the query is the server's to answer — nothing re-filters what it sends
      options={{ search: search_tickers }}
      // the control is as narrow as a symbol; the list is not
      popup_width="w-56"
      indicator={<CheckIcon className="text-gray-11 icon-sm" />}
      popup_vars={popup_vars}
      render={(t) => (
        <span className="grid gap-y-0.5 text-xs">
          <span className="font-semibold">{t.symbol}</span>
          <span>{t.name}</span>
        </span>
      )}
      // the schema has no empty ticker, and the seam only emits undefined from
      // a clear trigger this control doesn't offer
      value={ticker.value.symbol ? ticker.value : undefined}
      on_change={async (t) => {
        if (!t) return;
        // usdpu/min stay 0 until this ticker's own estimate lands — the schema
        // rejects a 0 price, so the previous pick's can't pass for a new symbol
        ticker.onChange({
          ...init_ticker_option,
          symbol: t.symbol,
          name: t.name,
          amount: getValues("ticker.amount"),
        } satisfies ITickerFv);
        set_ticker_state("loading");
        set_submitted_while_estimating(false);
        try {
          const res = await fetch(
            href("/api/tickers/:symbol/estimate", { symbol: t.symbol })
          );
          if (!res.ok) throw res;
          const { usdpu, min }: ITokenEstimate = await res.json();
          // finnhub quotes an unknown symbol at 0
          if (!(usdpu > 0)) throw new Error(`no price for ${t.symbol}`);
          set_ticker_state(undefined);
          // no stale resolve to drop: the combobox is disabled while this runs.
          // the amount input is not — read it now
          ticker.onChange({ ...getValues("ticker"), usdpu, min });
        } catch (err) {
          report_error(err);
          // a combobox emits only on a changed value, so the failed pick is
          // cleared — picking the same stock again is what retries
          ticker.onChange({
            ...init_ticker_option,
            amount: getValues("ticker.amount"),
          } satisfies ITickerFv);
          set_ticker_state("error");
        }
      }}
    />
  );

  const pin = don.pin === true;

  const fields = (
    <>
      <TokenField
        combobox={combobox}
        ref={ticker.ref}
        amount={ticker.value.amount}
        amount_usd={ticker.value.usdpu * +ticker.value.amount}
        on_change={(x) => ticker.onChange({ ...ticker.value, amount: x })}
        error={
          ticker_state === "error"
            ? ESTIMATE_ERROR
            : ticker_state === "loading" && submitted_while_estimating
              ? ESTIMATE_PENDING
              : errors.ticker?.amount?.message || errors.ticker?.symbol?.message
        }
        label="Stock donation details"
      />

      {don.recipient.hide_bg_tip ? null : (
        <TipField
          classes="mt-2"
          nudge={!!ticker.value.amount}
          checked={tip_format.value !== "none"}
          checked_changed={tip.checked_changed}
          tip_format={tip_format.value}
          tip_format_changed={tip.tip_format_changed}
          custom_tip={
            tip_format.value === "custom" ? (
              <div className="relative w-full flex items-baseline">
                <span className="font-bold text-xs self-baseline text-form-primary">
                  {ticker.value.symbol}
                </span>
                <input
                  {...register("tip")}
                  type="number"
                  step="any"
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

      <MethodBenefits subject="stock" classes="mt-4" />
    </>
  );

  const continue_btn = (
    <button
      disabled={isSubmitting}
      className={`${pin ? "" : "mt-auto "}btn btn-form-primary`}
      type="submit"
    >
      Continue
    </button>
  );

  const on_submit = handleSubmit(
    (fv) =>
      // skip donor step
      to_step("stocks", fv, "checkout", don_set),
    // usdpu is 0 until the estimate lands, so the schema rejects every
    // submit in that window — say why instead of failing silently
    () => {
      if (ticker_state === "loading") set_submitted_while_estimating(true);
    }
  );

  if (!pin) {
    return (
      <FormContainer
        className="flex flex-col gap-y-2 h-full"
        onSubmit={on_submit}
      >
        {fields}
        {continue_btn}
      </FormContainer>
    );
  }

  return (
    <FormContainer
      className="flex min-h-full flex-1 flex-col"
      onSubmit={on_submit}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-y-2 p-5 sm:p-6">
        {fields}
      </div>
      <div data-pin="" className={pin_bar}>
        {continue_btn}
      </div>
    </FormContainer>
  );
}
