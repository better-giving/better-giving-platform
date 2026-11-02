import { ArrowDownToLineIcon } from "lucide-react";
import { href } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import hexagon_badge from "#/assets/images/alliance-member-badge-hexagon.png";
import rectangle_badge from "#/assets/images/alliance-member-badge-rectangle.png";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { QrCode } from "./qr-code";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Alliance member badges", matches);

export default CacheRoute(Page);
function Page({ loaderData: d, params }: Route.ComponentProps) {
  const handle_download = (image_url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = image_url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Alliance member badges</h1>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-12">
        <div className="card grid gap-y-2 justify-items-center xl:col-start-1 xl:row-start-1">
          <img
            className="self-center"
            width={190}
            src={hexagon_badge}
            alt="Alliance Member Badge"
          />
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() =>
              handle_download(
                hexagon_badge,
                "alliance-member-badge-hexagon.png"
              )
            }
          >
            <ArrowDownToLineIcon className="icon-sm" />
            Download
          </button>
        </div>

        <div className="card grid gap-y-2 justify-items-center xl:col-start-1 xl:row-start-2">
          <img
            className="self-center"
            width={200}
            src={rectangle_badge}
            alt="Alliance Member Badge"
          />
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() =>
              handle_download(
                rectangle_badge,
                "alliance-member-badge-rectangle.png"
              )
            }
          >
            <ArrowDownToLineIcon className="icon-sm" />
            Download
          </button>
        </div>

        <QrCode
          grouped
          donate_url={`${d.base_url}${href("/donate/:id", { id: params.id })}`}
          profile_url={`${d.base_url}${href("/org/:org", { org: params.id })}`}
          logo={d.logo}
          classes="w-full max-w-96 xl:col-start-2 xl:row-start-1 xl:row-span-2"
        />
      </div>
    </div>
  );
}
