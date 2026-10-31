import { Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { IBapp } from "@/banking";
import type { Route } from "./+types/route";
import { Filter } from "./filter";
import { statuses } from "./filter/constants";
import { Table } from "./table";

export { ErrorBoundary } from "#/components/error";
export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta = () => metas({ title: "Banking Applications" });

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const status_key = (
    params.has("status") ? params.get("status")! : "under-review"
  ) as keyof typeof statuses;
  const status_label = statuses[status_key]?.toLowerCase() ?? "";

  const { node, loading } = use_table<IBapp>({
    table: ({ items, ...props }) => (
      <Table
        items={items.filter(
          (item) =>
            item.bank_summary?.toLowerCase().includes(query.toLowerCase()) ||
            item.npo_id?.toString().includes(query)
        )}
        empty_msg={`No ${status_label} banking applications found`}
        {...props}
      />
    ),
    page1,
    gen_loader: (load, next) => () => {
      const copy = new URLSearchParams(params);
      if (next) copy.set("nextPageKey", next);
      load(`?${copy.toString()}`);
    },
  });

  return (
    <div className="@container grid content-start gap-y-4 px-6 py-4 md:px-10 md:py-8 w-full">
      <h3 className="font-bold text-2xl">Banking Applications</h3>
      <div className="flex flex-wrap gap-3">
        <div className="field-input-container relative flex items-center @sm:flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 left-3 icon-xl" />
          <input
            disabled={loading}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="p-3 pl-10 bg-transparent w-full outline-hidden placeholder:text-gray-11"
            type="text"
            placeholder="Search banking applications"
          />
        </div>
        <Filter isDisabled={loading} classes="w-full @sm:w-auto" />
      </div>

      <div className="grid">{node}</div>
    </div>
  );
}
