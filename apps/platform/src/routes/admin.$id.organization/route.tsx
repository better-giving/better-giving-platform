import type { LinksFunction } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { richtext_styles, to_content } from "#/components/rich-text";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { sans_https } from "@/helpers/https";
import type { Route } from "./+types/route";
import { Form } from "./form";
import type { FV, ProfileFV } from "./schema";

export { action, loader } from "./api";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Organization", matches);
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const links: LinksFunction = () => [...richtext_styles];
export { ErrorBoundary } from "#/components/error";

export default CacheRoute(Page);
function Page({ loaderData: endow }: Route.ComponentProps) {
  const defaults: FV = {
    logo: endow.logo ?? "",
    name: endow.name,
    registration_number: endow.registration_number ?? "",
    endow_designation: endow.endow_designation,
    hq_country: endow.hq_country,
    slug: endow.slug ?? "",
    url: sans_https(endow.url) ?? "",
    street_address: endow.street_address ?? "",
    active_in_countries: endow.active_in_countries,
  };
  const profile: ProfileFV = {
    published: !!endow.published,
    social_media_urls: {
      facebook: sans_https(endow.social_media_urls?.facebook) ?? undefined,
      instagram: sans_https(endow.social_media_urls?.instagram) ?? undefined,
      linkedin: sans_https(endow.social_media_urls?.linkedin) ?? undefined,
      twitter: sans_https(endow.social_media_urls?.twitter) ?? undefined,
      discord: sans_https(endow.social_media_urls?.discord) ?? undefined,
      youtube: sans_https(endow.social_media_urls?.youtube) ?? undefined,
      tiktok: sans_https(endow.social_media_urls?.tiktok) ?? undefined,
    },
    tagline: endow.tagline ?? "",
    image: endow.image ?? "",
    overview: to_content(endow.overview_pt),
  };

  // the groups seed from `init` once; another org needs a fresh mount
  return (
    <Form
      key={endow.id}
      init={defaults}
      profile={profile}
      id={endow.id}
      base_url={endow.base_url}
      videos={endow.videos}
    />
  );
}
