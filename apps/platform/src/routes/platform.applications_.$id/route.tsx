import { Breadcrumb } from "@better-giving/ui";
import { href } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import Loaded from "./loaded";

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d?.reg) return [];
  return metas({
    title: `Application review - ${d.reg.o_name}`,
  });
};

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { reg, wacc, wacc_unavailable, approvable } = loaderData;

  return (
    <div className="grid content-start gap-y-4 gap-x-3 px-4 py-4 md:px-10 md:py-8 w-full">
      <Breadcrumb
        items={[
          { label: "NPO applications", to: href("/platform/applications") },
          { label: reg.o_name || "Application review" },
        ]}
      />
      <Loaded
        {...reg}
        bank={wacc}
        bank_unavailable={wacc_unavailable}
        approvable={approvable}
      />
    </div>
  );
}
