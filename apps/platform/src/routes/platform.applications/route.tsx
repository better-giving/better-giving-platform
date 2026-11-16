import { Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { IReg } from "@/reg";
import type { Route } from "./+types/route";
import { Filter } from "./filter";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export { ErrorBoundary } from "#/components/error";
export const meta: Route.MetaFunction = () =>
  metas({ title: "NPO applications" });

export default CacheRoute(Applications);
function Applications({ loaderData: page1 }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  // any filter or search narrows the list, so an empty one is "found", not "yet"
  const any_filter = [
    "status",
    "country",
    "start_date",
    "end_date",
    "query",
  ].some((k) => !!params.get(k));

  const { node, loading } = use_table<IReg>({
    // a filter or sort change drops every loaded page, and so does a cached
    // page 1 swapped for a fresh one under the same URL: hence the params plus
    // what page 1 is
    filter_key: `${params.toString()}|${page1.next ?? ""}|${page1.items[0]?.id ?? ""}`,
    table: ({ items, ...props }) => (
      <Table
        items={items}
        empty_msg={any_filter ? "No applications found" : "No applications yet"}
        connect_routing={page1.connect_routing}
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
    <div className="@container grid content-start gap-y-4 px-4 py-4 md:px-10 md:py-8 w-full">
      <h1 className="sr-only">NPO applications</h1>
      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={handle_search}
          className="field-input-container relative flex items-center @sm:flex-1"
        >
          <Search className="absolute top-1/2 -translate-y-1/2 left-3 icon-xl" />
          <input
            // uncontrolled, so a query cleared elsewhere (Reset filters) remounts it
            key={params.get("query") ?? ""}
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
