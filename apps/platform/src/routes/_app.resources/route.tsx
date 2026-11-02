import { EmptyState } from "@better-giving/ui";
import Fuse from "fuse.js";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { href, Link } from "react-router";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import {
  RESOURCE_TYPES,
  type ResourceType,
  resources,
  TYPE_LABELS,
} from "./data";
import { ResourceCard } from "./resource-card";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/resources")}`,
    title: "Resources",
    description:
      "Download whitepapers, case studies, product manuals, and templates to help your nonprofit succeed.",
  });

export { ErrorBoundary } from "#/components/error";

type Filter = ResourceType | "all";

const fuse = new Fuse(resources, {
  keys: ["name", "description"],
  threshold: 0.4,
});

export default function Resources() {
  const [query, set_query] = useState("");
  const [filter, set_filter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const searched = query ? fuse.search(query).map((r) => r.item) : resources;
    if (filter === "all") return searched;
    return searched.filter((r) => r.type === filter);
  }, [query, filter]);

  return (
    <div className="w-full grid content-start pb-16">
      {/* hero */}
      <section className="bg-band py-16">
        <div className="page grid gap-4 justify-items-center text-center">
          <h1 className="text-3xl sm:text-4xl font-bold">Resource Hub</h1>
          <p className="text-gray-11 max-w-xl">
            Download whitepapers, case studies, product manuals, and templates
            to power your nonprofit's growth.
          </p>
          <div className="relative w-full max-w-md mt-4">
            <Search className="icon-lg absolute left-3 top-1/2 -translate-y-1/2 text-gray-11" />
            <input
              type="text"
              placeholder="Search resources..."
              value={query}
              onChange={(e) => set_query(e.target.value)}
              className="field-input py-2.5 pl-10 pr-4 bg-surface"
            />
          </div>
        </div>
      </section>

      {/* filters + grid */}
      <div className="page mt-8 grid gap-6">
        <Link to={href("/resources/campaigns")} className="link text-sm">
          How to create a campaign
        </Link>

        {/* filter tabs */}
        <div className="flex flex-wrap gap-2">
          <FilterTab
            active={filter === "all"}
            onClick={() => set_filter("all")}
          >
            All Resources
          </FilterTab>
          {RESOURCE_TYPES.map((t) => (
            <FilterTab
              key={t}
              active={filter === t}
              onClick={() => set_filter(t)}
            >
              {TYPE_LABELS[t]}
            </FilterTab>
          ))}
        </div>

        {/* results */}
        {filtered.length === 0 ? (
          <EmptyState>No resources found</EmptyState>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((r) => (
              <ResourceCard key={r.name} resource={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-fg"
          : "bg-gray-3 hover:bg-gray-4 active:bg-gray-5"
      }`}
    >
      {children}
    </button>
  );
}
