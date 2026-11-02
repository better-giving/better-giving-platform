import { Breadcrumb } from "@better-giving/ui";
import { href, Outlet } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { Loaded } from "./loaded";

export { loader } from "#/pages/platform-admin/banking-applications/api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () =>
  metas({ title: "Banking application review" });
export { ErrorBoundary } from "#/components/error";
export default CacheRoute(Page);

function Page({ loaderData: bank }: Route.ComponentProps) {
  return (
    <div className="grid content-start gap-y-4 gap-x-3 px-4 py-4 md:px-10 md:py-8 w-full">
      <Breadcrumb
        items={[
          {
            label: "Banking applications",
            to: href("/platform/banking-applications"),
          },
          { label: bank.npo_name || "Banking application review" },
        ]}
      />
      <Loaded {...bank} />
      {/** prompts: approve, reject, success */}
      <Outlet />
    </div>
  );
}
