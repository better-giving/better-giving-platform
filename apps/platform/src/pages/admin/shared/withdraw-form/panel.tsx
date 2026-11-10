import { Field, Select } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { InfoIcon } from "lucide-react";
import { useEffect } from "react";
import { useController, useForm } from "react-hook-form";
import { humanize } from "@/helpers/decimal";
import { type Props, type Schema, type Source, schema, sources } from "./types";

const opts_display: { [K in Source]: string } = {
  liq: "Savings",
  lock: "Investments",
};

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
      // the dashboard offers both sources; a blank select there read as a
      // control with nothing in it, so it opens on the first like the presets
      source: props.from ?? sources[0],
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
      <h4 className="mb-3 text-xl">Withdraw</h4>

      <Select
        required
        ref={source.ref}
        label="Withdraw from"
        onChange={source.onChange}
        value={source.value}
        options={sources as any}
        error={errors.source?.message}
        option_disp={(opt) =>
          opt && (
            <p className="text-sm">
              <span>{opts_display[opt]}: </span>
              <span className="text-gray-11">${humanize(props.bals[opt])}</span>
            </p>
          )
        }
        disabled={props.is_submitting || !!props.from}
      />
      <Field
        classes="mt-5"
        required
        label="Amount"
        {...register("amount")}
        placeholder="e.g. 100"
        error={errors.amount?.message}
      />

      {source.value && (
        <div className="text-sm text-warning-subtle-fg bg-warning-subtle rounded p-2 mt-4">
          <InfoIcon className="inline relative bottom-px icon-md" /> This
          operation is irreversible. Withdrawing from{" "}
          {source.value === "liq"
            ? "savings"
            : "investments redeems underlying asset and"}{" "}
          creates a grant of corresponding value{" "}
          {source.value === "lock" ? " upon approval" : ""}.
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
