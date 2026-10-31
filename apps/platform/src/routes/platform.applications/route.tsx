import { Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { IReg } from "@/reg";
import type { Route } from "./+types/route";
import { Filter } from "./filter";
import { statuses } from "./filter/constants";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export { ErrorBoundary } from "#/components/error";
export const meta: Route.MetaFunction = () =>
  metas({ title: "Applications Review - Dashboard" });

export default CacheRoute(Applications);
function Applications({ loaderData: page1 }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const status_key = (
    params.has("status") ? params.get("status")! : "02"
  ) as keyof typeof statuses;
  const status_label = statuses[status_key]?.toLowerCase() ?? "";

  const { node, loading } = use_table<IReg>({
    table: ({ items, ...props }) => (
      <Table
        items={items}
        empty_msg={`No ${status_label} applications found`}
        {...props}
      />
    ),
    page1,
    gen_loader: (load, next) => () => {
      const copy = new URLSearchParams(params);
      if (next) copy.set("next", next);
      load(`?${copy.toString()}`);
    },
  });

  function handle_search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = (fd.get("query") as string)?.trim();
    const copy = new URLSearchParams(params);
    if (q) copy.set("query", q);
    else copy.delete("query");
    copy.delete("next");
    setParams(copy);
  }

  return (
    <div className="@container grid content-start gap-y-4 px-6 py-4 md:px-10 md:py-8 w-full">
      <h1 className="text-3xl font-bold">NPO Applications</h1>
      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={handle_search}
          className="field-input-container relative flex items-center @sm:flex-1"
        >
          <Search className="absolute top-1/2 -translate-y-1/2 left-3 icon-xl" />
          <input
            disabled={loading}
            name="query"
            defaultValue={params.get("query") ?? ""}
            className="p-3 pl-10 bg-transparent w-full outline-hidden placeholder:text-gray-11"
            type="text"
            placeholder="Search applications"
          />
        </form>
        <Filter isDisabled={loading} classes="w-full @sm:w-auto" />
      </div>

      <div className="grid">{node}</div>
    </div>
  );
}
