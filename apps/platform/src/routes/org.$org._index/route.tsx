import type { ComponentType } from "react";
import { href } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import flying_character from "#/assets/images/flying-character.webp";
import { Card } from "#/components/org-page/layouts/card";
import { Feature } from "#/components/org-page/layouts/feature";
import { Hub } from "#/components/org-page/layouts/hub";
import { Letter } from "#/components/org-page/layouts/letter";
import { Poster } from "#/components/org-page/layouts/poster";
import type { IOrgLayout } from "#/components/org-page/layouts/types";
import { richtext_styles } from "#/components/rich-text";
import { to_excerpt } from "#/components/rich-text/helpers";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { TOrgLayout } from "@/org-shape";
import { agents_link, org_jsonld } from "@/structured-data/schema-org";
import type { Route } from "./+types/route";
import { use_donor_messages } from "./donor-messages";
import { org_credential, org_details } from "./layout-data";

export { headers, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>({});

export const links: Route.LinksFunction = () => [...richtext_styles];
export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  const shared = {
    title: `${d.npo.name} - ${app_name}`,
    description: d.npo.tagline?.slice(0, 140),
    name: d.npo.name,
    image: d.npo.image || flying_character,
    // canonical route is /org/:org (slug, else id); /marketplace/:id 301s here
    url: d.url,
  };
  // a previewer's render of an unpublished org stays out of every index
  if (!d.npo.published) return metas(shared);
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: base_url },
      {
        "@type": "ListItem",
        position: 2,
        name: "Marketplace",
        item: `${base_url}/marketplace`,
      },
      { "@type": "ListItem", position: 3, name: d.npo.name, item: d.url },
    ],
  };
  const ngo = org_jsonld({
    base_url,
    id: d.npo.id,
    url: d.url,
    name: d.npo.name,
    logo: d.npo.logo,
    image: d.npo.image,
    description: d.npo.tagline?.trim() || to_excerpt(d.npo.overview_pt),
    country: d.npo.hq_country,
    street_address: d.npo.street_address,
    ein: d.ein,
    registration_number: d.npo.registration_number,
    website: d.npo.url,
    socials: d.npo.social_media_urls,
  });
  return [
    ...metas({ ...shared, jsonld: [breadcrumbs, ngo] }),
    agents_link(base_url),
  ];
};
export { ErrorBoundary } from "#/components/error";

const LAYOUTS: Record<TOrgLayout, ComponentType<IOrgLayout>> = {
  card: Card,
  poster: Poster,
  letter: Letter,
  hub: Hub,
  feature: Feature,
};

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  // keyed, so the messages paged in for one org never carry to the next
  return <OrgPage key={loaderData.npo.id} d={loaderData} />;
}

interface IOrgPage {
  d: Route.ComponentProps["loaderData"];
}

function OrgPage({ d }: IOrgPage) {
  const { npo } = d;
  const { messages, on_more } = use_donor_messages(
    npo.id,
    d.messages,
    d.messages_next
  );
  const Layout = LAYOUTS[d.layout];
  return (
    <Layout
      npo={npo}
      shape={d.shape}
      donate_to={href("/donate/:id", { id: String(npo.id) })}
      share={{ recipientName: npo.name, url: d.url }}
      now={d.now}
      give={d.lists.give}
      programs={d.lists.programs}
      videos={d.lists.videos}
      failed={d.lists.failed}
      messages={messages}
      on_more_messages={on_more}
      footer={org_details(npo)}
      credential={org_credential(npo)}
    />
  );
}
