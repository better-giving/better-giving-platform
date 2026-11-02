import { Plus } from "lucide-react";
import { NavLink } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { List } from "./list";

export { delete_action as action, members as loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";
export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Manage members", matches);

export default CacheRoute(Page);

function Page({ loaderData: data }: Route.ComponentProps) {
  return (
    <div className="grid content-start gap-y-6 @lg:gap-y-8 px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Manage members</h1>
      <NavLink className="btn btn-primary gap-2 justify-self-end" to="add">
        <Plus className="icon-md" />
        <span>Invite user</span>
      </NavLink>
      <List {...data} />
    </div>
  );
}
