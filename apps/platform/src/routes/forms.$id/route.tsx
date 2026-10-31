import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { parent_origin, Steps, type TDonation } from "#/components/donation";
import { donor_fv_blank } from "@/donations/schema";
import type { IForm } from "@/forms/interfaces";
import type { Route } from "./+types/route";

export { headers, loader } from "./api";

export default function Page({ loaderData, params }: Route.ComponentProps) {
  const { recipient_details: rd, base_url, ...d } = loaderData;
  // read off the live url rather than the loader: this response is shared-
  // cached (`s-maxage`), and a loader-borne value is frozen into the cached
  // payload the browser hydrates from — correct only for as long as the cdn
  // keys its entries on the query string. read here it is re-derived in the
  // browser, so it is this document's own embedder either way.
  const [sp] = useSearchParams();
  const host_origin = parent_origin(sp.get("parent_origin"));
  const init_state: TDonation = {
    base_url,
    method: d.donate_methods?.at(0) || ("stripe" as const),
    source: "bg-widget",
    mode: "preview",
    donor: donor_fv_blank,
    recipient: {
      id: d.recipient_fund_id ?? String(d.recipient_npo_id ?? ""),
      name: d.name,
      hide_bg_tip: rd.hide_bg_tip,
      members: [],
      donor_address_required: rd.donor_address_required,
    },
    config: {
      id: d.id,
      accent_primary: d.accent_primary ?? undefined,
      accent_secondary: d.accent_secondary ?? undefined,
      method_ids: d.donate_methods ?? undefined,
      increments: d.increments ?? undefined,
      success_redirect: d.success_redirect ?? undefined,
      freq_opts: d.freq_opts ?? undefined,
      prefill_amount_usd: (d.defaults as IForm["defaults"])?.stripe?.amount_usd,
      parent_origin: host_origin,
    },
    program: d.program_id
      ? { id: d.program_id, name: d.program_name! }
      : undefined,
  };

  useEffect(() => {
    const send_height_to_parent = () => {
      const height = document.body.scrollHeight;
      window.parent.postMessage(
        {
          type: "resize",
          form_id: params.id,
          height,
        },
        host_origin ?? "*"
      );
    };

    send_height_to_parent();

    const resize_observer = new ResizeObserver(() => {
      send_height_to_parent();
    });

    resize_observer.observe(document.body);

    return () => {
      resize_observer.disconnect();
    };
  }, [params.id, host_origin]);

  const steps = <Steps key={JSON.stringify(init_state)} init={init_state} />;

  if (d.status === "inactive") {
    return (
      <div className="relative" data-surfaces="embed">
        <div className="blur-sm pointer-events-none">{steps}</div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <p className="font-medium">This form has been disabled</p>
        </div>
      </div>
    );
  }

  // no blot ground on a nonprofit's page (src/index.css)
  return (
    <div className="contents" data-surfaces="embed">
      {steps}
    </div>
  );
}
