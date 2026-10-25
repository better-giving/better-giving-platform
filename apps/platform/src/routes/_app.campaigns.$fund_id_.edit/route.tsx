import { CircleAlert } from "lucide-react";
import { useFetcher } from "react-router";
import { richtext_styles } from "#/components/rich-text";
import type { Route } from "./+types/route";
import { Sections } from "./form";
import { PublishBanner } from "./publish-banner";

export { ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";
// no client loader cache: it serves the pre-save read first, so a just-saved
// section would re-seed dirty and the banner and Close would flicker back
export const links: Route.LinksFunction = () => [...richtext_styles];

export default function Page({ loaderData }: Route.ComponentProps) {
  const { fund, base_url } = loaderData;
  const fetcher = useFetcher();
  const is_toggling = fetcher.state !== "idle";
  const optimistic = is_toggling ? !fund.published : fund.published;

  if (!fund.active) {
    return (
      <div className="grid content-start place-items-center pt-40 pb-20">
        <CircleAlert className="text-destructive pictogram-lg" />
        <p className="text-xl mt-8">This campaign is closed</p>
      </div>
    );
  }

  return (
    // `page` owns the gutter, so nothing that paints an edge sits on it
    <div className="page mt-8 pb-8 grid content-start gap-6">
      <PublishBanner
        published={optimistic}
        fundId={fund.id}
        onToggle={() =>
          fetcher.submit(
            { published: !fund.published },
            { method: "POST", encType: "application/json" }
          )
        }
        isToggling={is_toggling}
      />
      <Sections
        fund={fund}
        base_url={base_url}
        init_slug={fund.slug ?? undefined}
      />
    </div>
  );
}
