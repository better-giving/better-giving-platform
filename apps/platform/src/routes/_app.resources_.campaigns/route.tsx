import { href, Link } from "react-router";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/resources/campaigns")}`,
    title: "Create a campaign",
    description:
      "How to create a campaign, choose its link, set payment options, and read the amount raised.",
  });

export { ErrorBoundary } from "#/components/error";

export default function Page() {
  return (
    <article className="page prose py-10">
      <p>
        <Link to={href("/resources")} className="link text-sm">
          Resources
        </Link>
      </p>
      <h1 className="text-3xl font-bold">Create a campaign</h1>
      <section className="grid gap-2">
        <h2 className="text-xl font-semibold">Campaign link</h2>
        <p>
          A live campaign is a public page at{" "}
          <span className="font-mono text-sm">
            /org/your-organization/your-campaign
          </span>
          . Set your Better Giving page link on Organization first. The campaign
          link can change until the first time you publish. After that it stays
          put, because a change would break links that already point at the
          page.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-semibold">Payment settings</h2>
        <p>
          Choose which payment methods and frequencies the donate box offers,
          and the suggested amounts. One-time stays available. A program on the
          campaign, when you set one, is the program each gift is credited to.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-semibold">Amount raised</h2>
        <p>
          The total on the page is the net of settled gifts attributed to the
          campaign. It is not a stored balance, and it moves when a settled gift
          is refunded in full.
        </p>
      </section>
    </article>
  );
}
