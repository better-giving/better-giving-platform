import { Combo, DrawerIcon } from "@better-giving/ui";
import { useState } from "react";

const COUNTRIES = [
  "Australia",
  "Brazil",
  "Japan",
  "Kenya",
  "United Kingdom",
  "United States",
];

const CAUSES = [
  "Animals",
  "Education",
  "Environment",
  "Health",
  "Human rights",
];

const drawer = (open: boolean) => <DrawerIcon is_open={open} size={20} />;

export const Selected = () => {
  const [value, set] = useState<string | undefined>("United Kingdom");
  return (
    <Combo
      required
      clearable
      label="Country of registration"
      placeholder="Select a country"
      value={value}
      on_change={set}
      on_reset={() => set(undefined)}
      options={COUNTRIES}
      adornment={drawer}
    />
  );
};

export const Placeholder = () => {
  const [value, set] = useState<string | undefined>();
  return (
    <Combo
      required
      clearable
      label="Country of registration"
      placeholder="Select a country"
      value={value}
      on_change={set}
      options={COUNTRIES}
      adornment={drawer}
    />
  );
};

export const LeadingAdornment = () => {
  const [value, set] = useState<string | undefined>("Japan");
  const flags: Record<string, string> = {
    Australia: "🇦🇺",
    Brazil: "🇧🇷",
    Japan: "🇯🇵",
    Kenya: "🇰🇪",
    "United Kingdom": "🇬🇧",
    "United States": "🇺🇸",
  };
  return (
    <Combo
      label="Headquarters"
      placeholder="Select a country"
      value={value}
      on_change={set}
      options={COUNTRIES}
      lead={
        value ? <span className="text-2xl">{flags[value]}</span> : undefined
      }
      adornment={drawer}
      render={(c) => (
        <>
          <span className="text-2xl">{flags[c]}</span>
          <span>{c}</span>
        </>
      )}
    />
  );
};

export const WithError = () => {
  const [value, set] = useState<string | undefined>();
  return (
    <Combo
      required
      clearable
      label="Primary cause"
      placeholder="Select a cause"
      value={value}
      on_change={set}
      options={CAUSES}
      adornment={drawer}
      error="Select a primary cause"
    />
  );
};

/** a caller-owned query still fetching: the control stays shut until it lands */
export const Loading = () => (
  <Combo
    label="Bank account currency"
    placeholder="Select a currency"
    value={undefined}
    on_change={() => {}}
    options={{ items: [], loading: true }}
    adornment={drawer}
  />
);

export const Disabled = () => (
  <Combo
    label="Country of registration"
    placeholder="Select a country"
    disabled
    value="Japan"
    on_change={() => {}}
    options={COUNTRIES}
    adornment={drawer}
  />
);
