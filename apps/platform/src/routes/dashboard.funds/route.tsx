import { Info } from "@better-giving/ui";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import type { Route } from "./+types/route";
import { Fund } from "./fund";

export { user_funds as loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";

export default CacheRoute(Page);
function Page({ loaderData: { funds } }: Route.ComponentProps) {
  const items =
    funds.length === 0 ? (
      <Info>No campaigns yet</Info>
    ) : (
      <div className="grid @xl:grid-cols-2 @2xl:grid-cols-3 gap-4">
        {funds.map((fund) => (
          <Fund key={fund.id} {...fund} />
        ))}
      </div>
    );
  return (
    <div className="grid px-6 py-4 md:px-10 md:py-8">
      <div className="flex items-center justify-between mb-2 w-full border-b border-hairline pb-4">
        <h3 className="text-3xl">My campaigns</h3>
      </div>
      {items}
    </div>
  );
}
