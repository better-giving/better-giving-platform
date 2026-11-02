import { Popover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import { DrawerIcon } from "@better-giving/ui";
import { FilterIcon } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { parse } from "valibot";
import { search } from "@/helpers/https";
import { regs_search } from "@/reg/schema";
import { Form } from "./form";
import type { FV } from "./schema";

type Props = {
  classes?: string;
  isDisabled: boolean;
};

export function Filter({ classes = "", isDisabled }: Props) {
  const [params, setParams] = useSearchParams();
  const [open, set_open] = useState(false);
  const parsed = parse(regs_search, search(params));

  async function onSubmit(fv: FV) {
    const copy = new URLSearchParams(params);
    for (const k of ["status", "country", "start_date", "end_date"] as const) {
      const val = fv[k];
      // always set status so "" (all) reaches the loader
      if (val || k === "status") copy.set(k, val ?? "");
      else copy.delete(k);
    }
    // preserve search query and sort across filter changes
    for (const k of ["query", "sort_key", "sort_dir"]) {
      const v = params.get(k);
      if (v) copy.set(k, v);
    }
    setParams(copy);
  }

  return (
    <div className={`${classes} flex relative items-center`}>
      <Popover.Root
        open={open}
        onOpenChange={(e) => set_open(e.open)}
        positioning={{ placement: "bottom", gutter: 4 }}
      >
        <Popover.Trigger
          disabled={isDisabled}
          className="w-full flex justify-center items-center p-3 rounded bg-primary text-primary-fg hover:bg-primary-hover lg:text-gray-11 lg:bg-surface lg:border lg:border-input lg:hover:bg-gray-4 lg:hover:border-input-hover lg:w-[22.3rem] lg:justify-between disabled:bg-gray-3 disabled:text-gray-11 lg:disabled:bg-gray-3 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <FilterIcon className="mr-1 lg:hidden icon-md" />
          <div className="font-semibold text-sm">Filter</div>
          <DrawerIcon is_open={open} className="hidden lg:inline icon-xl" />
        </Popover.Trigger>

        <Portal>
          <Popover.Positioner>
            <Form
              params={parsed}
              onSubmit={onSubmit}
              onReset={() => setParams({ status: "02" })}
            />
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    </div>
  );
}
