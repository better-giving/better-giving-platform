import { Field as BaseField } from "@ark-ui/react/field";
import { Field, Form, Increments } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useFieldArray, useForm } from "react-hook-form";
import { DonateFrequencies } from "#/components/donate-frequencies";
import { DonateMethods } from "#/components/donate-methods";
import { GoalSelector } from "#/components/goal-selector";
import { MoneyField } from "#/components/money-field";
import { bg_accent_primary, bg_accent_secondary } from "#/styles/colors";
import { increment_label_max_chars } from "@/schemas";
import { type FVBasic, schema_basic } from "./types";

interface Props extends FVBasic {
  classes?: string;
  is_submitting: boolean;
  on_submit: (fv: FVBasic) => void;
}

export function SettingsBasic({
  classes = "",
  on_submit,
  is_submitting,
  accent_primary = bg_accent_primary,
  accent_secondary = bg_accent_secondary,
  ...fv
}: Props) {
  const {
    handleSubmit,
    reset: hookFormReset,
    formState: { isDirty, errors, isSubmitting },
    watch,
    register,
    control,
  } = useForm<FVBasic>({
    resolver: valibotResolver(schema_basic),
    //set new config as default, so user would need to make a change to be able to update again
    values: { ...fv, accent_primary, accent_secondary },
  });

  const { field: donate_methods } = useController({
    control: control,
    name: "methods",
  });

  const increments = useFieldArray({
    control,
    name: "increments",
  });

  const { field: target } = useController({
    control,
    name: "target.type",
  });

  const { field: freqs } = useController({
    control,
    name: "frequencies",
  });

  const incs = watch("increments");

  return (
    <Form
      disabled={isSubmitting}
      className={`${classes} @container/configurer card self-start`}
      onSubmit={handleSubmit((x) => on_submit(x), console.error)}
      onReset={(e) => {
        e.preventDefault();
        hookFormReset();
      }}
    >
      <DonateMethods
        classes={{
          tooltip: "italic",
          label: "",
        }}
        values={donate_methods.value}
        on_change={donate_methods.onChange}
        ref={donate_methods.ref}
        error={
          <p className="text-destructive-subtle-fg text-xs mb-1 empty:hidden">
            {errors.methods?.message}
          </p>
        }
      />

      <DonateFrequencies
        classes="mt-6"
        value={freqs.value}
        on_change={freqs.onChange}
        error={errors.frequencies?.message}
        ref={freqs.ref}
      />

      <p className="mt-8 label">Style</p>
      <BaseField.Root className="flex items-center gap-2 mt-1">
        <input type="color" {...register("accent_primary")} />
        <BaseField.Label className="text-sm"> Accent primary</BaseField.Label>
      </BaseField.Root>
      <BaseField.Root className="flex items-center gap-2 mt-2">
        <input type="color" {...register("accent_secondary")} />
        <BaseField.Label className="text-sm">Accent secondary</BaseField.Label>
      </BaseField.Root>

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
                rows={2}
                {...register(`increments.${idx}.label`)}
                className="field-input font-medium"
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
        <p className="label mb-3">Donation goal</p>
        <GoalSelector value={target.value} onChange={target.onChange} />
        {target.value === "fixed" && (
          <MoneyField
            control={control}
            name="target.value"
            unregister
            label="How much money do you want to raise?"
            required
            classes="mt-4 mb-6"
            placeholder="$"
            error={errors?.target?.value?.message}
          />
        )}
      </div>

      <Field
        sub="A meaningful label to help you identify this form."
        {...register("tag")}
        label="Tag"
        placeholder="e.g. in mywebsite.com"
        required
        classes={{ container: "mt-6" }}
        error={errors.tag?.message}
      />

      <button
        disabled={!isDirty}
        type="submit"
        className="mt-6 justify-self-end btn btn-primary"
      >
        {isSubmitting ? "Saving.." : "Save"}
      </button>
    </Form>
  );
}
