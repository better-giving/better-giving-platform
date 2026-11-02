import { RadioGroup } from "@ark-ui/react/radio-group";
import type { TFrequency } from "@/schemas";
import { freqs_default } from "./constants";

const opt_style =
  "group text-sm rounded px-4 py-2 border border-gray-7 hover:not-data-[state=checked]:border-gray-8 flex items-center justify-center @md/frequency:justify-start hover:not-data-[state=checked]:bg-(--form-secondary) data-[state=checked]:bg-(--form-primary) data-[state=checked]:text-primary-fg data-[state=checked]:border-none data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 select-none";

const freqs_disp = {
  "one-time": "once",
  weekly: "weekly",
  monthly: "monthly",
  annual: "annually",
} as const;

export function opening_frequency(
  freq_opts: TFrequency[] | undefined,
  requested: TFrequency | undefined
): TFrequency {
  const shown = freqs_shown(freq_opts) ?? ["one-time"];
  if (requested && shown.includes(requested)) return requested;
  return "one-time";
}

export const freqs_shown = (
  freqs: TFrequency[] | undefined
): TFrequency[] | null => {
  if (!freqs || freqs.length === 0) return freqs_default;
  // hide frequency selector if only one option and it's one-time
  if (freqs.length === 1 && freqs[0] === "one-time") return null;
  return freqs;
};

interface Props {
  opts: TFrequency[] | undefined;
  value: TFrequency;
  onChange: (freq: TFrequency) => void;
  error?: string;
}
export function Frequency({
  value,
  onChange,
  error,
  opts = freqs_default,
}: Props) {
  return (
    <div className="@container/frequency">
      <RadioGroup.Root
        value={value}
        onValueChange={(e) => onChange(e.value as TFrequency)}
      >
        <RadioGroup.Label className="mb-1 label">
          Frequency <span className="text-destructive-subtle-fg">*</span>
        </RadioGroup.Label>
        <div className="grid grid-cols-2 gap-2 @md/frequency:flex">
          {opts.map((f) => (
            <RadioGroup.Item key={f} value={f} className={opt_style}>
              <RadioGroup.ItemText>Give {freqs_disp[f]}</RadioGroup.ItemText>
              <RadioGroup.ItemHiddenInput />
            </RadioGroup.Item>
          ))}
        </div>
      </RadioGroup.Root>
      {error && <p className="field-err text-left mt-1">{error}</p>}
      <p className="text-gray-11 text-sm my-2">
        <span className="font-medium text-sm">Recurring donations</span> help
        nonprofits focus on mission and long-term impact, not fundraising.
        Cancel anytime.
      </p>
    </div>
  );
}
