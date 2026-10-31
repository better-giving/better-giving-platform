import { Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { InfoIcon, MoveLeft, MoveRight } from "lucide-react";
import { useEffect } from "react";
import { useController, useForm } from "react-hook-form";
import { humanize } from "@/helpers/decimal";
import { type Props, type Schema, schema } from "./types";

export function Panel(props: Props) {
  const {
    handleSubmit,
    register,
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
        <div className="grid items-center grid-cols-[1fr_auto_1fr] gap-x-4 border-y border-hairline py-4">
          <p className=" justify-self-end">
            <span className="text-gray-11 text-xs mr-1">from</span>
            {source.value === "liq" ? (
              <span className="text-warning-subtle-fg font-semibold">
                Savings
              </span>
            ) : (
              <span className="text-success-subtle-fg font-semibold">
                Investments
              </span>
            )}
            <span className="text-sm font-semibold text-gray-11 ml-2">
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
            className="relative p-6 border-t hover:outline hover:outline-primary outline-primary rounded-full group"
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
          <p className=" justify-self-start">
            <span className="text-gray-11 text-xs mr-1">to</span>
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

      <Field
        classes="mt-4"
        required
        label="Amount"
        {...register("amount")}
        placeholder="e.g. $ 100"
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
