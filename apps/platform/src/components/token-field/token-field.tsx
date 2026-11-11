import { unpack } from "@better-giving/ui/helpers";
import type { Ref } from "react";
import { humanize } from "@/helpers/decimal";
import { useMoneyInput } from "../money-field";
import type { ITokenField } from "./types";

type El = HTMLInputElement;

const ERROR_ID = "amount_error";

export function TokenField({ ref, ...props }: ITokenField & { ref?: Ref<El> }) {
  const style = unpack(props.classes);
  const money = useMoneyInput({
    value: props.amount,
    onChange: props.on_change,
    places: props.places ?? Number.POSITIVE_INFINITY,
    ref,
  });

  return (
    <div className={`grid ${style.container}`}>
      <label
        data-required
        htmlFor="amount"
        className={`mr-auto label ${style.label}`}
      >
        {props.label}
      </label>

      <div className="mt-1 grid grid-cols-[auto_1fr] field-input-container rounded pr-5 divide-x divide-input">
        {props.combobox}
        {/** match input text, and append $ value */}
        <div className="relative h-full w-full">
          <input
            {...money}
            aria-invalid={!!props.error}
            // both, as on `Field`: errormessage is the right relationship,
            // describedby the one every screen reader reads
            aria-errormessage={props.error ? ERROR_ID : undefined}
            aria-describedby={props.error ? ERROR_ID : undefined}
            disabled={props.disabled}
            autoComplete="off"
            id="amount"
            placeholder="Enter amount"
            className={`outline-none w-full h-full ${style.input} bg-transparent placeholder:font-medium pl-2 py-3.5 font-semibold`}
          />
          {props.amount_usd ? (
            <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 left-2">
              <span className="invisible mr-1">{money.value}</span>{" "}
              <span className="text-gray-11 text-sm">
                ~${humanize(props.amount_usd)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {props.error && (
        <p
          id={ERROR_ID}
          data-error
          className="peer text-destructive-subtle-fg text-xs text-left mt-0.5"
        >
          {props.error}
        </p>
      )}
    </div>
  );
}
