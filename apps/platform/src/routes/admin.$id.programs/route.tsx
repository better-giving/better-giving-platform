import { RmxForm, useRmxForm } from "@better-giving/ui";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { List } from "./list";

export { action, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";
export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Programs", matches);

export default CacheRoute(Page);

function Page({ loaderData: { programs } }: Route.ComponentProps) {
  const { nav } = useRmxForm();

  return (
    <div className="grid content-start gap-y-6 @lg:gap-y-8 px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Programs</h1>
      <RmxForm method="POST" className="flex justify-end">
        <button
          type="submit"
          disabled={nav.state !== "idle"}
          className="btn btn-primary"
        >
          {nav.state === "submitting" ? "Creating..." : "Create program"}
        </button>
      </RmxForm>
      <List programs={programs} />
    </div>
  );
}
