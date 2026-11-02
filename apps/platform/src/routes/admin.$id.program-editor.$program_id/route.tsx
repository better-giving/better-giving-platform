import { Breadcrumb } from "@better-giving/ui";
import { href } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { richtext_styles } from "#/components/rich-text";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import Form from "./form";

export const links: Route.LinksFunction = () => [...richtext_styles];
export { action, loader } from "./api";

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  admin_page_meta(loaderData?.title ?? "Program", matches);
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export { ErrorBoundary } from "#/components/error";
export default CacheRoute(Page);

function Page({ loaderData: program, params }: Route.ComponentProps) {
  return (
    <div className="grid px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        items={[
          {
            label: "Programs",
            to: href("/admin/:id/programs", { id: params.id }),
          },
          { label: program.title || "Program" },
        ]}
      />
      <Form {...program} />
    </div>
  );
}
