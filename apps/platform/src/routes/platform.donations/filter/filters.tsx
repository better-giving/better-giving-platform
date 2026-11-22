import { Button } from "@better-giving/ui";
import { createContext, type ReactNode, useContext, useRef } from "react";
import {
  DEFAULT_METHOD,
  DEFAULT_STATUS,
  METHOD_ALL_LABEL,
  METHOD_OPTIONS,
  type MethodKey,
  method_chip,
  method_name,
  method_summary,
  STATUS_ALL_LABEL,
  STATUS_OPTIONS,
  type StatusKey,
  status_chip,
  status_name,
  status_summary,
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
  /** a load is in flight: the funnels and chips are disabled */
  loading: boolean;
  off_default: boolean;
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

export function Filters({
  status,
  method,
  loading,
  off_default,
  on_change,
  children,
}: IFilters) {
  const root = useRef<HTMLDivElement>(null);

  // the button removes itself once the defaults land, which would drop focus
  // to the body: hand it to the Status control that is on screen (the header
  // funnel from md, the chip under it)
  const clear = () => {
    const triggers = root.current?.querySelectorAll<HTMLElement>(
      "[data-filter-trigger=status]"
    );
    for (const t of triggers ?? []) {
      if (t.offsetParent) {
        t.focus();
        break;
      }
    }
    on_change({ status: [...DEFAULT_STATUS], method: [...DEFAULT_METHOD] });
  };

  const status_all = status.length === STATUS_OPTIONS.length;
  const status_menu = (trigger: "header" | "chip") => (
    <FilterMenu
      id="status"
      name="Status"
      trigger={trigger}
      chip_value={status_chip(status)}
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
  const method_menu = (trigger: "header" | "chip") => (
    <FilterMenu
      id="method"
      name="Method"
      trigger={trigger}
      chip_value={method_chip(method)}
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

  const clear_btn = (
    <Button type="button" variant="secondary" size="sm" onClick={clear}>
      Clear filters
    </Button>
  );

  return (
    <div ref={root} className="grid gap-4">
      {/* under md the header funnels are dropped for two chips */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        {status_menu("chip")}
        {method_menu("chip")}
        {off_default && clear_btn}
      </div>
      {off_default && (
        <div className="hidden md:flex items-center gap-3 min-h-8 text-sm text-gray-11">
          <span>
            Showing:{" "}
            <span className="font-medium text-gray-12">
              {status_summary(status)}
            </span>{" "}
            ·{" "}
            <span className="font-medium text-gray-12">
              {method_summary(method)}
            </span>
          </span>
          {clear_btn}
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
