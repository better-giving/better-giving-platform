import { NavLink, Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { Route } from "./+types/route";
import { FormsTable } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = () =>
  metas({ title: "Donation forms" });

export default CacheRoute(Page);
function Page({ loaderData: d }: Route.ComponentProps) {
  const [search] = useSearchParams();
  const { node } = use_table({
    table: (props) => <FormsTable {...props} status={d.status} />,
    page1: d,
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 h-full">
      <h1 className="sr-only">Donation forms</h1>
      <div className="flex items-start">
        <p className="flex-1 mb-6 font-medium mt-1">
          Accept donations from your website today!
        </p>
        <NavLink to="create" className="btn btn-primary">
          Create form
        </NavLink>
      </div>
      {node}
      {/** form-create prompt */}
      <Outlet />
    </div>
  );
}
