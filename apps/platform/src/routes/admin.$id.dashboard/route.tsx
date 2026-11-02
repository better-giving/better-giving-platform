import { Outlet } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import type { Route } from "./+types/route";
import { Loaded } from "./loaded";

export { endowUpdateAction as action, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";

export default CacheRoute(Dashboard);
function Dashboard({ loaderData: data }: Route.ComponentProps) {
  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full max-w-[1400px] grid content-start">
      <h1 className="sr-only">Dashboard</h1>
      <Loaded {...data} />
      <Outlet />
    </div>
  );
}
