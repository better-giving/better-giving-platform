import { Field, Form as FormContainer } from "@better-giving/ui";
import { ru_vdec } from "@/helpers/decimal";
import { usd_option } from "../../common/constants";
import { CpfToggle } from "../../common/cpf-toggle";
import { Incrementers } from "../../common/incrementers";
import { TipField } from "../../common/tip-field";
import { tip_handlers } from "../../common/tip-handlers";
import { use_donation } from "../../context";
import { pin_bar } from "../../pin";
import { type TMethodState, to_step } from "../../types";
import { use_rhf } from "./use-rhf";

export function Form(props: TMethodState<"daf">) {
  const { don_set, don } = use_donation();
  const rhf = use_rhf(props.fv);

  const tip = tip_handlers({
    format: rhf.tip_format,
    set_value: (v) => rhf.setValue("tip", v),
    set_focus: () => rhf.setFocus("tip"),
    str: (pct) => {
      const amnt = rhf.getValues("amount");
      if (!amnt) return "";
      return ru_vdec((pct / 100) * +amnt, 1);
    },
  });

  const pin = don.pin === true;

  const fields = (
    <>
      <Field
        required
        {...rhf.register("amount")}
        inputMode="decimal"
        label="Donation amount"
        classes={{ label: "" }}
        placeholder="Enter amount (USD)"
        error={rhf.errors.amount?.message}
      />

      <Incrementers
        on_increment={rhf.on_increment}
        code={usd_option.code}
        rate={usd_option.rate}
        increments={don.config?.increments}
        precision={0}
      />

      {don.recipient.hide_bg_tip ? null : (
        <TipField
          classes="mt-2"
          nudge={!!rhf.watch("amount")}
          checked={rhf.tip_format.value !== "none"}
          checked_changed={tip.checked_changed}
          tip_format={rhf.tip_format.value}
          tip_format_changed={tip.tip_format_changed}
          custom_tip={
            rhf.tip_format.value === "custom" ? (
              <div className="relative w-full flex items-baseline">
                <span className="font-bold text-xs self-baseline text-form-primary">
                  {usd_option.code}
                </span>
                <input
                  {...rhf.register("tip")}
                  type="number"
                  step="any"
                  className="w-full text-sm pl-1 focus:outline-none"
                  placeholder="Enter tip"
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
        classes="mb-2"
        checked={rhf.cpf.value}
        checked_changed={(x) => rhf.cpf.onChange(x)}
      />
    </>
  );

  // no `disabled` of its own — FormContainer's fieldset carries
  // `disabled={rhf.isSubmitting}` and already makes this unpressable
  // while a submit is in flight
  const continue_btn = (
    <button
      className={`${pin ? "" : "mt-auto "}btn btn-form-primary`}
      type="submit"
    >
      Continue
    </button>
  );

  const on_submit = rhf.handleSubmit((fv) =>
    // skip donor step
    to_step("daf", fv, "checkout", don_set)
  );

  if (!pin) {
    return (
      <FormContainer
        disabled={rhf.isSubmitting}
        onSubmit={on_submit}
        className="flex flex-col gap-y-2 min-h-full"
      >
        {fields}
        {continue_btn}
      </FormContainer>
    );
  }

  return (
    <FormContainer
      disabled={rhf.isSubmitting}
      onSubmit={on_submit}
      className="flex min-h-full flex-1 flex-col"
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
