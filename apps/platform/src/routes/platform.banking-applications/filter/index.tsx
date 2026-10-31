import { Popover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import {
  Actions,
  DrawerIcon,
  Field,
  popup_anim,
  Select,
} from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { FilterIcon } from "lucide-react";
import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useSearchParams } from "react-router";
import * as v from "valibot";
import { statuses } from "./constants";

type Props = {
  classes?: string;
  isDisabled: boolean;
};

const int_id_param = v.lazy((x) => {
  if (!x) return v.string();
  return v.pipe(
    v.string(),
    v.trim(),
    v.transform((x) => +x),
    v.integer("invalid id"),
    v.minValue(1, "invalid id"),
    v.transform((x) => x.toString())
  );
});

const schema = v.object({
  endowment_id: int_id_param,
  status: v.string(),
});

interface FV extends v.InferOutput<typeof schema> {}

export function Filter({ classes = "", isDisabled }: Props) {
  const [params, setParams] = useSearchParams();
  const [open, set_open] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    control,
  } = useForm<FV>({
    mode: "onChange",
    reValidateMode: "onChange",
    resolver: valibotResolver(schema),
    values: {
      endowment_id: params.get("endowmentID") || "",
      status: params.has("status") ? params.get("status")! : "under-review",
    },
  });

  const { field: stat } = useController({ control, name: "status" });

  function submit(fv: FV) {
    const copy = new URLSearchParams(params);
    // always set status so "" (all) reaches the loader
    copy.set("status", fv.status);
    if (fv.endowment_id) copy.set("endowmentID", fv.endowment_id);
    else copy.delete("endowmentID");
    copy.delete("nextPageKey");
    setParams(copy);
    set_open(false);
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
          className="w-full flex justify-center items-center p-3 rounded bg-primary text-primary-fg lg:text-gray-11 lg:bg-surface lg:w-[22.3rem] lg:justify-between disabled:bg-gray-11 disabled:text-gray-11 lg:disabled:bg-gray-3 lg:border focus-visible:outline-none"
        >
          <FilterIcon className="mr-1 lg:hidden icon-md" />
          <div className="font-semibold text-sm">Filter</div>
          <DrawerIcon is_open={open} className="hidden lg:inline icon-xl" />
        </Popover.Trigger>

        <Portal>
          <Popover.Positioner>
            <Popover.Content
              asChild
              className={`grid content-start gap-4 w-(--reference-width) bg-card rounded-card shadow-floating text-gray-12 ${popup_anim}`}
            >
              <form
                onSubmit={handleSubmit(submit)}
                onReset={(e) => {
                  e.preventDefault();
                  reset();
                  setParams({ status: "under-review" });
                  set_open(false);
                }}
              >
                <Field
                  {...register("endowment_id")}
                  label="Endowment ID"
                  classes="mx-6 mt-4"
                  error={errors.endowment_id?.message}
                />

                <Select
                  ref={stat.ref}
                  value={stat.value ?? ""}
                  onChange={stat.onChange}
                  label="Application Status"
                  options={Object.keys(statuses)}
                  option_disp={(s) => (statuses as any)[s]}
                  classes={{
                    button: "",
                    options: "text-sm",
                    container: "px-5",
                  }}
                />

                <Actions band align="split" classes="lg:mt-2">
                  <button
                    type="reset"
                    className="text-primary underline text-sm"
                  >
                    Reset filters
                  </button>
                  <button type="submit" className="btn btn-primary font-bold">
                    Apply filters
                  </button>
                </Actions>
              </form>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    </div>
  );
}
