import { Menu } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import { popup_anim } from "@better-giving/ui";
import { ChevronDown, Filter } from "lucide-react";

export interface IOption {
  value: string;
  label: string;
}

interface IFilterMenu {
  /** "Status" or "Method": the header text and the chip's name */
  name: string;
  /** which control this is, for the focus handoff after Clear filters */
  id: "status" | "method";
  options: IOption[];
  selected: string[];
  /** the top row's label and state */
  all_label: string;
  all_state: boolean | "mixed";
  on_all: () => void;
  on_toggle: (value: string, next: boolean) => void;
  /** the trigger's accessible name, carrying the value */
  aria_label: string;
  /** off the default: the funnel fills, the chip tints */
  active: boolean;
  disabled: boolean;
  /** a header funnel, or a 375 chip showing `chip_value` */
  trigger: "header" | "chip";
  chip_value?: string;
}

const header_btn =
  "glyph-btn text-gray-11 hover:bg-gray-4 disabled:bg-gray-3 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";
const header_active = "text-primary [&_svg]:fill-current";
const chip_btn =
  "inline-flex items-center gap-1 min-h-8 px-3 py-1.5 text-sm font-medium rounded border border-input bg-surface disabled:bg-gray-3 disabled:text-gray-11 focus-visible:outline-2 focus-visible:outline-ring";
const chip_active = "bg-secondary! border-ring text-accent-12";

const row =
  "flex items-center gap-3 px-3 py-2 text-sm rounded cursor-pointer hover:bg-secondary-hover data-highlighted:bg-secondary-hover data-[state=checked]:bg-secondary-active data-highlighted:outline-2 data-highlighted:outline-ring data-highlighted:-outline-offset-2";

/** the checkbox glyph; the row itself is the control, so this is decoration */
function Box({ state }: { state: boolean | "mixed" }) {
  return (
    <input
      type="checkbox"
      className="checkbox"
      tabIndex={-1}
      aria-hidden
      readOnly
      checked={state === true}
      ref={(el) => {
        if (el) el.indeterminate = state === "mixed";
      }}
    />
  );
}

/**
 * a column-header filter: a trigger and a checkbox list. every tick applies at
 * once, so the list stays open; Escape, an outside click or Tab closes it and
 * focus returns to the trigger.
 */
export function FilterMenu(p: IFilterMenu) {
  return (
    <Menu.Root
      closeOnSelect={false}
      positioning={{ placement: "bottom-start", gutter: 4 }}
    >
      <Menu.Trigger
        data-filter-trigger={p.id}
        disabled={p.disabled}
        aria-label={p.aria_label}
        className={
          p.trigger === "header"
            ? `${header_btn} ${p.active ? header_active : ""} max-md:hidden`
            : `${chip_btn} ${p.active ? chip_active : ""} md:hidden`
        }
      >
        {p.trigger === "header" ? (
          <Filter className="icon-sm" aria-hidden />
        ) : (
          <>
            <span className="font-normal text-gray-11">{p.name}</span>
            {p.chip_value}
            <ChevronDown className="icon-sm" aria-hidden />
          </>
        )}
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            className={`z-floating grid w-max min-w-45 p-2 rounded-card bg-popover text-gray-12 border border-hairline shadow-floating focus:outline-0 ${popup_anim}`}
          >
            <Menu.CheckboxItem
              value="__all"
              checked={p.all_state === true}
              // ark has no mixed state: the role is checkbox, the value ours
              aria-checked={p.all_state === "mixed" ? "mixed" : p.all_state}
              onCheckedChange={() => p.on_all()}
              className={`${row} border-b border-hairline rounded-b-none mb-1`}
            >
              <Box state={p.all_state} />
              {p.all_label}
            </Menu.CheckboxItem>
            {p.options.map((o) => {
              const on = p.selected.includes(o.value);
              return (
                <Menu.CheckboxItem
                  key={o.value}
                  value={o.value}
                  checked={on}
                  onCheckedChange={(next) => p.on_toggle(o.value, next)}
                  className={row}
                >
                  <Box state={on} />
                  {o.label}
                </Menu.CheckboxItem>
              );
            })}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
