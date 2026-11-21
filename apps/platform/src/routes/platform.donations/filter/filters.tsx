import { Button, Select, Tabs } from "@better-giving/ui";
import { type ReactNode, useRef } from "react";
import {
  DEFAULT_METHOD,
  DEFAULT_STATUS,
  METHOD_OPTIONS,
  type MethodFilter,
  STATUS_OPTIONS,
  type StatusFilter,
} from "./constants";

interface IFilters {
  status: StatusFilter;
  method: MethodFilter;
  /** a load is in flight: the select is disabled, tabs ignore clicks */
  loading: boolean;
  on_change: (next: { status: StatusFilter; method: MethodFilter }) => void;
  /** the `TabPanel` wrapping the table */
  children: ReactNode;
}

const tabs = STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
const method_values = METHOD_OPTIONS.map((o) => o.value);
const method_label = (v: MethodFilter) =>
  METHOD_OPTIONS.find((o) => o.value === v)?.label;

export function Filters({
  status,
  method,
  loading,
  on_change,
  children,
}: IFilters) {
  const off_default = status !== DEFAULT_STATUS || method !== DEFAULT_METHOD;
  const root = useRef<HTMLDivElement>(null);

  // the button removes itself once the defaults land, which would drop focus
  // to the body; hand it to the default tab first
  const clear = () => {
    root.current
      ?.querySelector<HTMLElement>(`[role=tab][data-value=${DEFAULT_STATUS}]`)
      ?.focus();
    on_change({ status: DEFAULT_STATUS, method: DEFAULT_METHOD });
  };

  // `Tabs` renders its panel under its own list. its root is laid out as
  // `contents`, so the list, the controls and the panel are grid items of one
  // grid: from md the controls sit on the list's row, at 375 they stack.
  return (
    <div
      ref={root}
      className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] **:data-[part=content]:col-span-full"
    >
      <Tabs
        items={tabs}
        value={status}
        onValueChange={(v) => {
          if (!loading) on_change({ status: v, method });
        }}
        className="contents"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:col-start-2 md:row-start-1 md:justify-end md:self-stretch md:border-b">
          <Select
            compact
            label="Payment method"
            options={method_values}
            value={method}
            disabled={loading}
            onChange={(v) => on_change({ status, method: v })}
            option_disp={method_label}
            classes={{
              container: "flex items-center gap-3",
              label: "mb-0!",
              button:
                "whitespace-nowrap min-w-36 disabled:bg-gray-3 disabled:text-gray-11",
            }}
          />
          {off_default && (
            <Button type="button" variant="secondary" size="sm" onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>
        {children}
      </Tabs>
    </div>
  );
}
