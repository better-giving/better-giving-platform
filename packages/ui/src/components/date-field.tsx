import {
  DateInput,
  type DateInputDateValue as DateValue,
} from "@ark-ui/react/date-input";
import { parseDate } from "@ark-ui/react/date-picker";
import { useViewerToday } from "./use-viewer-today";

interface IDateField {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  label?: string;
  error?: string;
  minToday?: boolean;
  maxToday?: boolean;
  required?: boolean;
  classes?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const to_dv = (s: string) => (ISO.test(s) ? [parseDate(s)] : []);
export function DateField({
  value,
  onChange,
  name,
  label = "Date",
  error,
  minToday,
  maxToday,
  required,
  classes = "",
}: IDateField) {
  const min_today = useViewerToday("min");
  const max_today = useViewerToday("max");
  return (
    <DateInput.Root
      selectionMode="single"
      value={to_dv(value)}
      min={minToday ? parseDate(min_today) : undefined}
      max={maxToday ? parseDate(max_today) : undefined}
      onValueChange={({ value }) => onChange(value[0]?.toString() ?? "")}
      className={classes}
    >
      <DateInput.Label
        className="label mb-1"
        data-required={required || undefined}
      >
        {label}
      </DateInput.Label>
      <DateInput.Control className="flex items-center gap-2">
        <DateInput.SegmentGroup
          index={0}
          className="flex-1 min-w-0 flex items-center gap-0.5 px-2 py-3.5 rounded border border-input hover:border-input-hover bg-surface text-sm text-gray-12 data-invalid:border-destructive focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2"
          data-invalid={error ? true : undefined}
        >
          <DateInput.SegmentContext>
            {(seg: DateValue | unknown) => (
              <DateInput.Segment
                segment={seg as any}
                className="px-0.5 rounded focus-visible:outline-none focus-visible:bg-primary focus-visible:text-primary-fg data-placeholder:not-focus-visible:text-gray-11 figures"
              />
            )}
          </DateInput.SegmentContext>
        </DateInput.SegmentGroup>
      </DateInput.Control>
      <DateInput.HiddenInput index={0} name={name} />
      <p className="field-err mt-1 empty:hidden">{error}</p>
    </DateInput.Root>
  );
}
