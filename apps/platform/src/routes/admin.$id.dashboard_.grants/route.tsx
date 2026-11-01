import { ChevronLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_ctx } from "#/.server/auth";
import { use_table } from "#/hooks/use-table";
import { OwedHistory } from "#/routes/_helpers/owed-history";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import {
  grant_run_deductions,
  npo_owed_history,
} from "$/pg/queries/owed-history";
import { npo_settlements, type SettlementRow } from "$/pg/queries/payout";
import type { Route } from "./+types/route";
import { GrantsTable, type IGrantLine } from "./common/grants-table";

export const loader = async (x: Route.LoaderArgs) => {
  const { next } = search(x.url);
  const id = x.context.get(admin_ctx);

  // the history is the page's, not each grant page's: a load-more reads
  // only its grants
  const [page, owed] = await Promise.all([
    npo_settlements(id, { next, limit: 5 }),
    next ? undefined : npo_owed_history(id),
  ]);
  return {
    ...page,
    items: await with_deductions(id, page.items),
    ...(owed && { owed }),
  };
};
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

/** a grant that recovered anything owed carries its gross, deductions and net */
function with_deductions(
  npo_id: number,
  grants: SettlementRow[]
): Promise<IGrantLine[]> {
  return Promise.all(
    grants.map(async (g) => {
      const run = await grant_run_deductions(npo_id, g.id);
      return run && run.deductions.length > 0 ? { ...g, run } : g;
    })
  );
}

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Grants", matches);

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const [search] = useSearchParams();
  const { node } = use_table({
    page1: loaderData,
    table: (x) => <GrantsTable {...x} />,
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });

  return (
    <div className="grid content-start px-6 py-4 md:px-10 md:py-8">
      <Link to=".." className="flex items-center gap-1 link text-sm -ml-1 mb-3">
        <ChevronLeft className="icon-lg" />
        <span>Back</span>
      </Link>
      {node}
      <OwedHistory
        rows={loaderData.owed ?? []}
        run_noun="grant"
        received_label="Received"
      />
    </div>
  );
}
