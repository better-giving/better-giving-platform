import { RadioGroup as Ark } from "@ark-ui/react/radio-group";
import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";

export interface IRadio<T extends string> {
  value: T;
  label: ReactNode;
  /** `tile` only: a second, muted line under the label */
  description?: ReactNode;
  /** `tile` only: leads the label */
  icon?: ReactNode;
  disabled?: boolean;
}

interface Props<T extends string> {
  items: IRadio<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** `radio` is a dot beside each label; `tile` is a bordered card per option */
  variant?: "radio" | "tile";
  /** the group's name, read before each option */
  label: ReactNode;
  /** keeps `label` as the accessible name without drawing it, where a heading
   * above the group already says the same thing */
  hideLabel?: boolean;
  /** `tile` only: two tiles per row from `sm` up, stacked below it */
  columns?: 1 | 2;
  /** outer placement only — width, margin */
  className?: string;
}

const radio_item =
  "group flex cursor-pointer items-center gap-2 text-sm data-disabled:cursor-default data-disabled:text-gray-11";

const radio_control =
  "flex size-5 shrink-0 items-center justify-center rounded-full border border-input hover:not-data-disabled:border-input-hover bg-surface transition-colors data-[state=checked]:not-data-disabled:bg-primary data-disabled:bg-gray-3 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-ring";

const radio_dot =
  "invisible size-2 rounded-full bg-primary-fg group-data-[state=checked]:visible group-data-disabled:bg-gray-11";

// the label keeps its resting ink when checked: the fill, border and check
// carry the state, and `--primary` on `--secondary-active` has no ledger entry.
const tile_item =
  "group flex cursor-pointer items-center gap-3 rounded border border-gray-7 p-4 transition-colors hover:not-data-disabled:border-primary data-[state=checked]:border-primary data-[state=checked]:not-data-disabled:bg-secondary-active data-disabled:cursor-default data-disabled:bg-gray-3 data-disabled:text-gray-11 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-ring";

export function RadioGroup<T extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = "radio",
  label,
  hideLabel = false,
  columns = 1,
  className = "",
}: Props<T>) {
  const id = useId();
  const list =
    variant === "radio"
      ? "grid gap-2"
      : `grid gap-3 ${columns === 2 ? "sm:grid-cols-2" : ""}`;

  return (
    <Ark.Root
      value={value}
      defaultValue={defaultValue}
      // null only when nothing is checked, which a click or arrow key never causes
      onValueChange={
        onValueChange &&
        ((e) => e.value !== null && onValueChange(e.value as T))
      }
      className={className}
    >
      <Ark.Label className={hideLabel ? "sr-only" : "label mb-2"}>
        {label}
      </Ark.Label>
      <div className={list}>
        {items.map((it, i) =>
          variant === "radio" ? (
            <Ark.Item
              key={it.value}
              value={it.value}
              disabled={it.disabled}
              className={radio_item}
            >
              <Ark.ItemControl className={radio_control}>
                <span className={radio_dot} />
              </Ark.ItemControl>
              <Ark.ItemText>{it.label}</Ark.ItemText>
              <Ark.ItemHiddenInput />
            </Ark.Item>
          ) : (
            <Ark.Item
              key={it.value}
              value={it.value}
              disabled={it.disabled}
              className={tile_item}
            >
              {it.icon}
              <span className="grid flex-1 gap-1">
                <Ark.ItemText className="text-sm font-medium">
                  {it.label}
                </Ark.ItemText>
                {it.description && (
                  <span id={`${id}-${i}-desc`} className="text-sm text-gray-11">
                    {it.description}
                  </span>
                )}
              </span>
              <Check
                aria-hidden
                className="icon-xl shrink-0 text-transparent group-data-[state=checked]:text-primary"
              />
              {/* zag names the input by ItemText alone, so the description reaches a screen reader only through aria-describedby */}
              <Ark.ItemHiddenInput
                aria-describedby={
                  it.description ? `${id}-${i}-desc` : undefined
                }
              />
            </Ark.Item>
          )
        )}
      </div>
    </Ark.Root>
  );
}
