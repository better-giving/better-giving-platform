import { href } from "react-router";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";
import { Donate } from "./donate";
import { Manifesto } from "./manifesto";
import { UnderdogLetter } from "./underdog-letter";
import { Values } from "./values";
import { Volunteer } from "./volunteer";

// origin only — the donation band's post-payment return url must land on the
// host the donor is on (preview/dev/prod), not the build-time VITE_BASE_URL.
// user-independent by design: no session, no cookies, nothing per-visitor, so
// the s-maxage below still holds.
export const loader = ({ request }: Route.LoaderArgs) => ({
  base_url: new URL(request.url).origin,
});

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/about-us")}`,
    title: `About Us | ${app_name}`,
    description:
      "Since 2021, Better Giving has offered donation forms, savings, and fund growth tools, with a simple belief: the organizations doing the work should keep the money.",
  });

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-20 pb-20 text-center">
        <div className="page">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            About Better Giving
          </p>
          <h1 className="hero-heading mt-4 max-w-4xl mx-auto">
            A nonprofit whose mission is your mission's money
          </h1>
          <p className="mt-5 text-lg text-gray-11 max-w-2xl mx-auto text-pretty">
            Since 2021, Better Giving has offered donation forms, savings, and
            fund growth tools, with a simple belief: the organizations doing the
            work should keep the money.
          </p>
        </div>
      </div>

      <div className="surface-primary py-24">
        <div className="page">
          <div className="max-w-3xl mx-auto grid justify-items-center gap-5 text-center">
            <span
              className="text-6xl/none font-bold text-secondary h-9"
              aria-hidden
            >
              “
            </span>
            <p className="text-2xl md:text-3xl/normal font-medium text-pretty">
              We believe a new model of philanthropy is possible, not based on
              scarcity and dependence, but on abundance and financial
              self-sufficiency.
            </p>
            <span className="text-primary-fg/90">
              Chauncey St. John - Founder &amp; Executive Director
            </span>
          </div>
        </div>
      </div>

      <UnderdogLetter classes="py-24" />
      <Manifesto classes="bg-band py-24" />
      <Volunteer classes="py-24" />
      <Values classes="bg-band py-24" />

      <CtaBand
        title="Build the commons with us"
        subtitle="Register online, or read the code."
      />

      <Donate base_url={loaderData.base_url} classes="bg-band py-24" />
    </main>
  );
}
