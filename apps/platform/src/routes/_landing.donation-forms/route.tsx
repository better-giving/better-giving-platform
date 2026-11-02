import { href } from "react-router";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { FAQ, faqs } from "#/pages/@sections/faq";
import { Partners } from "#/pages/@sections/partners";
import { Steps } from "#/pages/@sections/steps";
import type { Route } from "./+types/route";
import { BottomCta } from "./bottom-cta";
import { Ctas } from "./ctas";
import { DonationFormInfo } from "./donation-form-info";
import { Members } from "./members";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/donation-forms")}`,
    title: `All-In-One Donation Form | ${app_name}`,
    description:
      "Raise more. Save more. Do less. No setup costs, no recurring charges. No platform fee while the optional donor contribution stays on.",
  });

export default function Page() {
  return (
    <>
      <DonationFormInfo classes="page" />
      <Partners classes="page mt-16" />
      <Ctas classes="page" />
      <Steps classes="page" />
      <Members classes="page" />
      <BottomCta />
      <FAQ classes="page my-24" items={[faqs[1], faqs[2], faqs[3], faqs[4]]} />
    </>
  );
}
