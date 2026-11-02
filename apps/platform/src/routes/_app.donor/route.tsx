import { href } from "react-router";
import { base_url } from "#/constants/env";
import { benefits } from "#/content/benefits";
import { metas } from "#/helpers/seo";
import { Benefits } from "#/pages/@sections/benefits";
import type { Route } from "./+types/route";
import { BottomCta } from "./bottom-cta";
import { DonationFormInfo } from "./donation-form-info";
import { Hero } from "./hero";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/donor")}`,
    title: "For Donors",
    description:
      "Easily support grassroots organizations all over the world with card, crypto, stock, and DAF gifts that keep on giving. No platform fee while the optional donor contribution stays on.",
  });

export default function Page({ classes = "" }) {
  return (
    <main className={`${classes} grid @container`}>
      <Hero classes="page" />
      <DonationFormInfo classes="mt-20 page" />
      <Benefits
        classes="mt-56 page"
        heading="Making a Lasting Impact: Give today, Give Forever"
        body="Access our free fundraising technology and tools."
        items={benefits.sf}
      />
      <BottomCta classes="mt-40 mb-20 max-w-5xl @5xl:max-w-6xl justify-self-center mx-4 @md:mx-10" />
    </main>
  );
}
