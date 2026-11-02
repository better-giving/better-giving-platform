import { Field } from "@ark-ui/react/field";
import { Fieldset } from "@ark-ui/react/fieldset";
import type { Ref } from "react";

interface Props {
  classes?: string;
  value: boolean[];
  on_change: (frequencies: boolean[]) => void;
  error?: string;
}

export function DonateFrequencies({
  classes = "",
  ref,
  ...p
}: Props & { ref?: Ref<HTMLInputElement> }) {
  return (
    <Fieldset.Root className={classes}>
      <Fieldset.Legend className="label mb-1">
        Donation frequency
      </Fieldset.Legend>
      <input ref={ref} className="sr-only" />
      <p className="text-destructive-subtle-fg text-xs mb-2 empty:hidden">
        {p.error}
      </p>
      {/* the box is a container (hairline); each row is a whole label, so the
          row is the control: it rests on the field fill and hovers at step 4.
          the checkbox carries checked; an unchecked row's label drops to the
          low-contrast ink beside it. */}
      <div className="border border-hairline rounded overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Field.Root key={idx}>
            <Field.Label
              data-unchecked={p.value[idx] ? undefined : ""}
              className="flex items-center gap-2 p-3 min-h-12 bg-surface hover:bg-gray-4 transition-colors text-sm text-gray-12 data-unchecked:text-gray-11 cursor-pointer"
            >
              <Field.Input
                type="checkbox"
                className="checkbox"
                checked={p.value[idx] || false}
                onChange={(e) => {
                  const new_values = [...p.value];
                  new_values[idx] = e.target.checked;
                  p.on_change(new_values);
                }}
              />
              {idx === 0
                ? "One time"
                : idx === 1
                  ? "Weekly"
                  : idx === 2
                    ? "Monthly"
                    : "Annual"}
            </Field.Label>
          </Field.Root>
        ))}
      </div>
    </Fieldset.Root>
  );
}
