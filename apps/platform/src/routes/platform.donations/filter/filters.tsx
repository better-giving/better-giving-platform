import { Button } from "@better-giving/ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { FilterChip } from "./chips";
import {
  DEFAULT_METHOD,
  DEFAULT_STATUS,
  filter_chips,
  METHOD_ALL_LABEL,
  METHOD_OPTIONS,
  type MethodKey,
  method_name,
  STATUS_ALL_LABEL,
  STATUS_OPTIONS,
  type StatusKey,
  status_name,
  without_method,
  without_status,
} from "./constants";
import { FilterMenu } from "./menu";

export interface ISel {
  status: StatusKey[];
  method: MethodKey[];
}

/** the two header funnels, for the table's header cells */
interface IHeaderFilters {
  status: ReactNode;
  method: ReactNode;
}

const HeaderFilters = createContext<IHeaderFilters | null>(null);

/** the funnels `Filters` built from the current selection, for a header cell */
export const useHeaderFilters = () => useContext(HeaderFilters);

interface IFilters extends ISel {
  /** a load is in flight: the funnels and triggers are disabled */
  loading: boolean;
  on_change: (next: ISel) => void;
  /** the table, which reads the funnels through `useHeaderFilters` */
  children: ReactNode;
}

const status_opts = STATUS_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));
const method_opts = METHOD_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

/** the list in option order, so the url and the label read the same */
const ordered = <K extends string>(all: { value: K }[], set: K[]) =>
  all.map((o) => o.value).filter((v) => set.includes(v));

/** the Status control on screen: the header funnel from md, the trigger under it */
const status_trigger = (root: HTMLElement | null) =>
  [
    ...(root?.querySelectorAll<HTMLElement>("[data-filter-trigger=status]") ??
      []),
  ].find((t) => t.offsetParent);

export function Filters({
  status,
  method,
  loading,
  on_change,
  children,
}: IFilters) {
  const root = useRef<HTMLDivElement>(null);
  const chips = filter_chips(status, method);
  const chip_key = chips.map((c) => `${c.group}:${c.value}`).join("|");

  // a × removes its chip, so focus would drop to the body: it goes to the chip
  // that takes that place, else Clear filters, else the Status control. the
  // chips rerender with the new selection, so the move waits for them
  const pending_focus = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chips change
  useEffect(() => {
    const at = pending_focus.current;
    if (at === null) return;
    pending_focus.current = null;
    const el = root.current;
    (
      el?.querySelectorAll<HTMLElement>("[data-chip-remove]")[at] ??
      el?.querySelector<HTMLElement>("[data-clear]") ??
      status_trigger(el)
    )?.focus();
  }, [chip_key]);

  const remove = (i: number) => {
    const c = chips[i]!;
    pending_focus.current = i;
    if (c.group === "status") {
      on_change({ method, status: without_status(status, c.value) });
    } else {
      on_change({ status, method: without_method(method, c.value) });
    }
  };

  // the button removes itself once the defaults land, which would drop focus
  // to the body: hand it to the Status control first
  const clear = () => {
    status_trigger(root.current)?.focus();
    on_change({ status: [...DEFAULT_STATUS], method: [...DEFAULT_METHOD] });
  };

  const status_all = status.length === STATUS_OPTIONS.length;
  const status_menu = (trigger: "header" | "plain") => (
    <FilterMenu
      id="status"
      name="Status"
      trigger={trigger}
      options={status_opts}
      selected={status}
      all_label={STATUS_ALL_LABEL}
      all_state={status_all ? true : "mixed"}
      // select-all: unticking it leaves the default, never an empty table
      on_all={() =>
        on_change({
          method,
          status: status_all
            ? [...DEFAULT_STATUS]
            : status_opts.map((o) => o.value),
        })
      }
      on_toggle={(v, next) => {
        const set = next
          ? ordered(status_opts, [...status, v as StatusKey])
          : status.filter((s) => s !== v);
        on_change({ method, status: set.length ? set : [...DEFAULT_STATUS] });
      }}
      aria_label={status_name(status)}
      active={status.length !== 1 || status[0] !== DEFAULT_STATUS[0]}
      disabled={loading}
    />
  );
  const method_menu = (trigger: "header" | "plain") => (
    <FilterMenu
      id="method"
      name="Method"
      trigger={trigger}
      options={method_opts}
      selected={method}
      all_label={METHOD_ALL_LABEL}
      // ticked only when nothing else is
      all_state={method.length === 0}
      on_all={() => on_change({ status, method: [...DEFAULT_METHOD] })}
      on_toggle={(v, next) =>
        on_change({
          status,
          method: next
            ? ordered(method_opts, [...method, v as MethodKey])
            : method.filter((m) => m !== v),
        })
      }
      aria_label={method_name(method)}
      active={method.length > 0}
      disabled={loading}
    />
  );

  return (
    <div ref={root} className="grid gap-4">
      {/* under md the header funnels are dropped for two plain triggers */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        {status_menu("plain")}
        {method_menu("plain")}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c, i) => (
            <FilterChip
              key={`${c.group}:${c.value}`}
              chip={c}
              on_remove={() => remove(i)}
            />
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-clear
            onClick={clear}
          >
            Clear filters
          </Button>
        </div>
      )}
      <HeaderFilters
        value={{
          status: status_menu("header"),
          method: method_menu("header"),
        }}
      >
        {children}
      </HeaderFilters>
    </div>
  );
}
