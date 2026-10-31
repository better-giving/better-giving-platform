import { Toggle } from "@better-giving/ui";
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { useFetcher } from "react-router";
import { RouteModal } from "#/components/route-modal";
import { use_admin_data } from "#/pages/admin/use-admin-data";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { EndowmentUpdate } from "#/services/types";
import { default_allocation } from "@/constants/common";
import type { IAllocation } from "@/donations";
import { alloc_opts, to_alloc_opt_value } from "./common";
import { AllocationOptions } from "./options";
import { AllocationSlider } from "./slider";

export { ErrorModal as ErrorBoundary } from "#/components/error";

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "edit-alloc";

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Choose allocation", matches);

export default function AllocationEdit() {
  const data = use_admin_data();
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      busy={fetcher.state !== "idle"}
      classes="grid gap-y-4 bg-card p-6"
    >
      <Content {...(data?.endow.allocation ?? default_allocation)} />
    </RouteModal>
  );
}

function Content(props: IAllocation) {
  const fetcher = useFetcher({ key: fetcher_key });
  const [alloc, set_alloc] = useState<IAllocation>(props);
  const [is_custom, set_is_custom] = useState(
    alloc_opts.every((opt) => opt.value !== to_alloc_opt_value(props))
  );

  const is_loading = fetcher.state !== "idle";

  return (
    <>
      <h4>Choose allocation</h4>

      <AllocationOptions
        value={alloc}
        onChange={(v) => {
          set_is_custom(false);
          set_alloc(v);
        }}
      />

      <Toggle
        value={is_custom}
        onChange={set_is_custom}
        classes={{ container: "mt-4" }}
      >
        Set custom allocation
      </Toggle>
      {is_custom && (
        <AllocationSlider
          disabled={is_loading}
          value={alloc}
          onChange={(v) => set_alloc(v)}
        />
      )}

      <button
        disabled={is_loading}
        type="button"
        className="btn btn-primary mt-4"
        onClick={async () => {
          const update: EndowmentUpdate = { allocation: alloc };
          fetcher.submit(update, {
            method: "PATCH",
            action: "..",
            encType: "application/json",
          });
        }}
      >
        {is_loading ? "Updating.." : "Save"}
      </button>
    </>
  );
}
