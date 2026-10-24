import { TabPanel, Tabs } from "@better-giving/ui";
import { Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { DonateMethodId } from "@/schemas";
import type { Route } from "./+types/route";
import { DonationTab } from "./donation";
import { DonationFormTab } from "./donation-form";
import { FundraiserTab } from "./fundraiser";

export { action, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Settings", matches);

export default CacheRoute(Page);

const TABS = [
  { id: "donation", name: "Donation" },
  { id: "fundraisers", name: "Supporter campaigns" },
  { id: "donation-form", name: "Donation Form" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** a missing or unknown `tab` is Donation; `campaign` is the previous Fundraisers value */
function shown_tab(raw: string | null): TabId {
  if (raw === "fundraisers" || raw === "campaign") return "fundraisers";
  if (raw === "donation-form") return "donation-form";
  return "donation";
}

function Page({ loaderData: endow }: Route.ComponentProps) {
  const [params, set_params] = useSearchParams();
  const tab = shown_tab(params.get("tab"));
  return (
    <div className="w-full max-w-[1112px] px-6 md:px-10">
      <h1 className="pt-4 md:pt-8 mb-6 text-3xl font-bold">Settings</h1>
      <Tabs
        items={TABS.map((item) => ({ value: item.id, label: item.name }))}
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          set_params(next, { preventScrollReset: true });
        }}
      >
        <div className="py-4 md:py-8">
          <TabPanel value="donation">
            <DonationTab
              receipt_msg={endow.receipt_msg ?? ""}
              donor_address_required={endow.donor_address_required ?? false}
              hide_bg_tip={endow.hide_bg_tip ?? false}
            />
          </TabPanel>
          <TabPanel value="fundraisers">
            <FundraiserTab fund_opt_in={endow.fund_opt_in ?? false} />
          </TabPanel>

          <TabPanel value="donation-form">
            <DonationFormTab
              donate_methods={
                endow.donate_methods ?? (["stripe"] as DonateMethodId[])
              }
              increments={endow.increments ?? []}
              freqs={endow.donate_frequencies ?? undefined}
            />
          </TabPanel>
        </div>
      </Tabs>
      <Outlet />
    </div>
  );
}
