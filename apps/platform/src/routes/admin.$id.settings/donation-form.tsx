import { Field as BaseField } from "@ark-ui/react/field";
import { Actions, Form as F, Increments } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useFieldArray, useForm } from "react-hook-form";
import { useFetcher } from "react-router";
import * as v from "valibot";
import { DonateFrequencies } from "#/components/donate-frequencies";
import { DonateMethods, fill } from "#/components/donate-methods";
import { MoneyField } from "#/components/money-field";
import { donate_method } from "#/types/components";
import { to_freq_bools, to_freqs } from "@/helpers/donation";
import type { DonateMethodId, INpoUpdate } from "@/npo";
import {
  donate_freq_opts_bool,
  increment,
  increment_label_max_chars,
  MAX_NUM_INCREMENTS,
  type TFrequency,
} from "@/schemas";
import { SaveAlert } from "./helpers";

const schema = v.object({
  increments: v.pipe(
    v.array(increment),
    v.maxLength(
      MAX_NUM_INCREMENTS,
      ({ requirement }) => `cannot have more than ${requirement} increments`
    )
  ),
  donate_methods: v.pipe(
    v.array(donate_method),
    v.filterItems((m) => !m.disabled),
    v.minLength(1, "at least one payment option should be active")
  ),
  freqs: donate_freq_opts_bool,
});

type FV = v.InferInput<typeof schema>;

interface Props {
  donate_methods: DonateMethodId[];
  increments: { label: string; value: string }[];
  freqs: TFrequency[] | undefined;
}

export function DonationFormTab(p: Props) {
  const fetcher = useFetcher();

  const {
    reset,
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
    control,
    watch,
  } = useForm<FV>({
    resolver: valibotResolver(schema),
    values: {
      donate_methods: fill(p.donate_methods),
      increments: p.increments,
      freqs: to_freq_bools(p.freqs),
    },
  });

  const { field: donate_methods } = useController({
    control,
    name: "donate_methods",
  });

  const increments = useFieldArray({
    control,
    name: "increments",
  });

  const { field: freqs } = useController({
    control,
    name: "freqs",
  });

  const incs = watch("increments");

  const onSubmit = handleSubmit(async ({ donate_methods, freqs, ...fv }) => {
    const update: Partial<INpoUpdate> = {
      ...fv,
      donate_methods: donate_methods
        .filter((m) => !m.disabled)
        .map((m) => m.id),
      donate_frequencies: to_freqs(freqs),
    };

    fetcher.submit(update as any, {
      method: "POST",
      action: ".",
      encType: "application/json",
    });
  });

  return (
    <F
      disabled={isSubmitting || fetcher.state !== "idle"}
      onReset={(e) => {
        e.preventDefault();
        reset();
        fetcher.reset();
      }}
      onSubmit={onSubmit}
      className="grid content-start gap-6"
    >
      <DonateMethods
        classes={{
          container: "mt-2",
          label: "",
          tooltip: "text-sm",
        }}
        values={donate_methods.value}
        on_change={donate_methods.onChange}
        error={errors.donate_methods?.message}
        ref={donate_methods.ref}
      />

      <DonateFrequencies
        value={freqs.value}
        on_change={freqs.onChange}
        classes="mt-6"
        error={errors.freqs?.message}
        ref={freqs.ref}
      />

      <Increments
        classes="mt-8 mb-10"
        fields={increments.fields}
        onAdd={(val) => {
          if (increments.fields.length >= 4) {
            return alert("You can only have 4 increments");
          }
          increments.append({ value: val, label: "" });
        }}
        onRemove={(idx) => increments.remove(idx)}
        countError={errors.increments?.root?.message}
        field={(idx) => (
          <>
            <MoneyField
              control={control}
              name={`increments.${idx}.value`}
              label={`Increment ${idx + 1} amount`}
              placeholder="$"
              classes={{
                // a cell of the Increments subgrid: the "Amount" column header is
                // the visible label
                container: "grid grid-rows-subgrid row-span-2",
                label: "sr-only",
                input: "h-full font-medium",
              }}
              error={errors.increments?.[idx]?.value?.message}
            />
            <BaseField.Root className="grid grid-rows-subgrid row-span-2">
              <textarea
                {...register(`increments.${idx}.label`)}
                rows={2}
                className="w-full outline-ring rounded text-sm font-medium bg-surface px-4 py-3.5 placeholder:text-gray-11 border border-input enabled:hover:border-input-hover disabled:pointer-events-none disabled:bg-gray-3 disabled:text-gray-11"
              />
              <p
                data-error={!!errors.increments?.[idx]?.label?.message}
                className="mt-1 text-left text-xs data-[error='true']:text-destructive-subtle-fg"
              >
                {incs[idx].label.length}/{increment_label_max_chars}
              </p>
            </BaseField.Root>
          </>
        )}
      />

      <div>
        <SaveAlert data={fetcher.data} />
        <Actions>
          <button
            type="reset"
            className="btn-secondary btn"
            disabled={!isDirty}
          >
            Reset changes
          </button>
          <button type="submit" className="btn btn-primary" disabled={!isDirty}>
            Submit changes
          </button>
        </Actions>
      </div>
    </F>
  );
}
