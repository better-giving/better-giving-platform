import { valibotResolver } from "@hookform/resolvers/valibot";
import { InfoIcon, MoveLeft, MoveRight } from "lucide-react";
import { useEffect } from "react";
import { useController, useForm } from "react-hook-form";
import { MoneyField } from "#/components/money-field";
import { humanize } from "@/helpers/decimal";
import { type Props, type Schema, schema } from "./types";

export function Panel(props: Props) {
  const {
    handleSubmit,
    formState: { errors, isDirty },
    control,
    setError,
    setValue,
  } = useForm<Schema>({
    defaultValues: {
      source: props.from || "liq",
      bals: props.bals,
    },
    resolver: valibotResolver(schema),
  });

  const { field: source } = useController({ name: "source", control });

  // defaultValues are read once at mount; a revalidated balance has to be
  // written in, silently, so the amount and any refusal on it survive.
  // keyed on the figures — callers pass a fresh `bals` object every render
  const { liq, lock } = props.bals;
  useEffect(() => {
    setValue("bals", { liq, lock });
  }, [liq, lock, setValue]);

  // keyed on the submit settling too: a repeat refusal carries the same string,
  // and the resubmit's own validation has already cleared the last one
  useEffect(() => {
    if (props.is_submitting || !props.error) return;
    setError(
      "amount",
      { type: "server", message: props.error },
      { shouldFocus: true }
    );
  }, [props.error, props.is_submitting, setError]);

  return (
    <form onSubmit={handleSubmit(props.onSubmit)} className="contents">
      <h4 className="mb-3 text-xl">
        Transfer{" "}
        {props.from
          ? props.from === "liq"
            ? "to Investments"
            : "to Savings"
          : null}
      </h4>

      {props.from ? (
        <div>
          <p className="text-gray-11 text-sm font-semibold">Balance</p>
          <p className="text-lg font-semibold text-gray-11">
            ${humanize(props.bals[source.value])}
          </p>
        </div>
      ) : (
        <div className="grid items-center grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-4 border-y border-hairline py-4">
          {/* flex-wrap: the spans hold no whitespace between them, so as
              inline text the side is one unbreakable word at 390 */}
          <p className="justify-self-end flex flex-wrap items-baseline justify-end gap-x-1">
            <span className="text-gray-11 text-xs">from</span>
            {source.value === "liq" ? (
              <span className="text-warning-subtle-fg font-semibold">
                Savings
              </span>
            ) : (
              <span className="text-success-subtle-fg font-semibold">
                Investments
              </span>
            )}
            <span className="text-sm font-semibold text-gray-11 ml-1">
              ${humanize(props.bals[source.value])}
            </span>
          </p>

          <button
            type="button"
            aria-label={
              source.value === "liq"
                ? "Transfer from Investments to Savings"
                : "Transfer from Savings to Investments"
            }
            onClick={() =>
              source.onChange(source.value === "liq" ? "lock" : "liq")
            }
            className="relative p-6 border border-gray-7 hover:border-gray-8 hover:bg-gray-4 active:bg-gray-5 transition-colors rounded-full group focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="absolute-center">
              <MoveLeft
                strokeWidth={2}
                className="relative top-1.5 right-1 group-active:right-1.5 stroke-gray-11 icon-xl"
              />
              <MoveRight
                strokeWidth={2}
                className={`icon-xl relative bottom-1.5 left-1 group-active:left-1.5 ${source.value === "liq" ? "stroke-success" : "stroke-warning"}`}
              />
            </div>
          </button>
          <p className="justify-self-start flex flex-wrap items-baseline gap-x-1">
            <span className="text-gray-11 text-xs">to</span>
            {source.value === "liq" ? (
              <span className="text-success-subtle-fg font-semibold">
                Investments
              </span>
            ) : (
              <span className="text-warning-subtle-fg font-semibold">
                Savings
              </span>
            )}
          </p>
        </div>
      )}

      <MoneyField
        classes="mt-4"
        required
        label="Amount"
        control={control}
        name="amount"
        placeholder="e.g. 100"
        error={errors.amount?.message}
      />

      {source.value && (
        <div className="text-sm text-warning-subtle-fg bg-warning-subtle rounded p-2 mt-4">
          <InfoIcon className="inline relative bottom-px icon-md" /> This
          operation is irreversible.{" "}
          {source.value === "liq"
            ? "Transferring to investments purchases underlying asset of corresponding value"
            : "Withdrawing from investments redeems underlying asset of corresponding value after approval"}
          .
        </div>
      )}

      <button
        type="submit"
        disabled={props.is_submitting || !isDirty}
        className="btn btn-primary mt-8"
      >
        {props.is_submitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
