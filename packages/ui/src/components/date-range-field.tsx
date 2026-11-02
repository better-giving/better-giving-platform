import {
  DateInput,
  type DateInputDateValue as DateValue,
} from "@ark-ui/react/date-input";
import { parseDate } from "@ark-ui/react/date-picker";
import { useViewerToday } from "./use-viewer-today";

interface IDateRangeField {
  startValue: string;
  endValue: string;
  onChange: (start: string, end: string) => void;
  startName?: string;
  endName?: string;
  label?: string;
  error?: string;
  maxToday?: boolean;
  classes?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const to_dv = (s: string) => (ISO.test(s) ? [parseDate(s)] : []);

export function DateRangeField({
  startValue,
  endValue,
  onChange,
  startName = "start_date",
  endName = "end_date",
  label = "Date",
  error,
  maxToday = true,
  classes = "",
}: IDateRangeField) {
  const viewer_today = useViewerToday("max");
  const max = maxToday ? parseDate(viewer_today) : undefined;

  return (
    <DateInput.Root
      selectionMode="range"
      value={[...to_dv(startValue), ...to_dv(endValue)]}
      max={max}
      onValueChange={({ value }) => {
        const [s, e] = value;
        onChange(s?.toString() ?? "", e?.toString() ?? "");
      }}
      className={classes}
    >
      <DateInput.Label className="label mb-1">{label}</DateInput.Label>
      <DateInput.Control className="flex items-center gap-2">
        <SegGroup index={0} invalid={!!error} />
        <span className="text-gray-11 text-sm" aria-hidden="true">
          →
        </span>
        <SegGroup index={1} invalid={!!error} />
      </DateInput.Control>
      <DateInput.HiddenInput index={0} name={startName} />
      <DateInput.HiddenInput index={1} name={endName} />

      <p className="field-err mt-1 empty:hidden">{error}</p>
    </DateInput.Root>
  );
}

function SegGroup({ index, invalid }: { index: number; invalid: boolean }) {
  return (
    <DateInput.SegmentGroup
      index={index}
      className="flex-1 min-w-0 flex items-center gap-0.5 px-2 py-3.5 rounded border border-input hover:border-input-hover bg-surface text-sm text-gray-12 data-invalid:border-destructive focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2"
      data-invalid={invalid || undefined}
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
  );
}
