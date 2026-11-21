import { Button, Select, Tabs } from "@better-giving/ui";
import type { ReactNode } from "react";
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
  METHOD_OPTIONS.find((o) => o.value === v)?.label ?? v;

export function Filters({
  status,
  method,
  loading,
  on_change,
  children,
}: IFilters) {
  const off_default = status !== DEFAULT_STATUS || method !== DEFAULT_METHOD;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              on_change({ status: DEFAULT_STATUS, method: DEFAULT_METHOD })
            }
          >
            Clear filters
          </Button>
        )}
      </div>
      <Tabs
        items={tabs}
        value={status}
        onValueChange={(v) => {
          if (!loading) on_change({ status: v, method });
        }}
        className="grid gap-4"
      >
        {children}
      </Tabs>
    </div>
  );
}
