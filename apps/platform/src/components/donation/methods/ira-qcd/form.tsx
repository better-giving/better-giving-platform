import { Field, Form as FormContainer } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useForm } from "react-hook-form";
import { ru_vdec } from "@/helpers/decimal";
import { usd_option } from "../../common/constants";
import type { OnIncrement } from "../../common/incrementers";
import { Incrementers } from "../../common/incrementers";
import { MethodBenefits } from "../../common/method-benefits";
import { TipField } from "../../common/tip-field";
import { tip_handlers } from "../../common/tip-handlers";
import { use_donation } from "../../context";
import { pin_bar } from "../../pin";
import {
  type IraQcdDonationDetails as FV,
  ira_qcd_donation_details,
  type TMethodState,
  to_step,
} from "../../types";

export function Form(props: TMethodState<"ira_qcd">) {
  const { don_set, don } = use_donation();
  const hide_tip = don.recipient.hide_bg_tip ?? false;

  const initial: FV = {
    amount: "",
    tip: "",
    tip_format: "none",
    custodian: "",
  };

  const {
    register,
    control,
    handleSubmit,
    getValues,
    trigger,
    setValue,
    setFocus,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FV>({
    defaultValues: props.fv || initial,
    resolver: valibotResolver(ira_qcd_donation_details),
    criteriaMode: "all",
  });

  const { field: tip_format } = useController({ control, name: "tip_format" });

  const tip = tip_handlers({
    format: tip_format,
    set_value: (v) => setValue("tip", v),
    set_focus: () => setFocus("tip"),
    str: (pct) => {
      const amnt = getValues("amount");
      if (!amnt) return "";
      return ru_vdec((pct / 100) * +amnt, 1);
    },
  });

  const on_increment: OnIncrement = (inc) => {
    const amnt = Number(getValues("amount"));
    if (Number.isNaN(amnt)) return trigger("amount", { shouldFocus: true });
    setValue("amount", ru_vdec(inc + amnt, 1, 0), { shouldValidate: true });
  };

  const pin = don.pin === true;

  const fields = (
    <>
      <Field
        required
        {...register("amount")}
        inputMode="decimal"
        label="Donation amount"
        classes={{ label: "" }}
        placeholder="Enter amount (USD)"
        error={errors.amount?.message}
      />

      <Incrementers
        on_increment={on_increment}
        code={usd_option.code}
        rate={usd_option.rate}
        increments={don.config?.increments}
        precision={0}
      />

      <Field
        {...register("custodian")}
        label="IRA provider / custodian"
        classes={{ label: "" }}
        placeholder="e.g. Fidelity, Schwab, Vanguard"
        error={errors.custodian?.message}
      />

      {hide_tip ? null : (
        <TipField
          classes="mt-2"
          nudge={!!watch("amount")}
          checked={tip_format.value !== "none"}
          checked_changed={tip.checked_changed}
          tip_format={tip_format.value}
          tip_format_changed={tip.tip_format_changed}
          custom_tip={
            tip_format.value === "custom" ? (
              <div className="relative w-full flex items-baseline">
                <span className="font-bold text-xs self-baseline text-form-primary">
                  {usd_option.code}
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

      <MethodBenefits subject="ira_qcd" classes="mt-4" />
    </>
  );

  // no `disabled` of its own — FormContainer's fieldset carries
  // `disabled={isSubmitting}` and already makes this unpressable while a
  // submit is in flight
  const continue_btn = (
    <button
      className={`${pin ? "" : "mt-auto "}btn btn-form-primary`}
      type="submit"
    >
      Continue
    </button>
  );

  const on_submit = handleSubmit((fv) =>
    // skip donor step
    to_step("ira_qcd", fv, "checkout", don_set)
  );

  if (!pin) {
    return (
      <FormContainer
        disabled={isSubmitting}
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
      disabled={isSubmitting}
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
