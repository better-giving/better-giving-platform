import { href } from "react-router";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";
import { PriceCards } from "./price-cards";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/pricing")}`,
    title: `Pricing | ${app_name}`,
    description:
      "Fundraising with no platform fee while the optional donor contribution stays on. Turning that ask off is 1.5%. Fiscal sponsorship is 2.9% of each sponsored gift.",
  });

export default function Page() {
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-20 pb-16 text-center">
        <div className="page">
          <h1 className="hero-heading max-w-3xl mx-auto">
            Free. Forever. <span className="text-primary">Really.</span>
          </h1>
          <p className="mt-5 text-lg text-gray-11 max-w-2xl mx-auto text-pretty">
            Not free-then-paid. Not free-with-gated-features. We're a nonprofit
            like you. There is no platform fee while donors can add an optional
            contribution. Turning that ask off is a 1.5% fee. Fiscal sponsorship
            is 2.9% of each sponsored gift.
          </p>
        </div>
      </div>

      <PriceCards classes="bg-band pt-4 pb-24" />

      <div className="page py-24">
        <div className="max-w-3xl mx-auto grid gap-5 justify-items-center text-center">
          <h2 className="section-heading">How much does Better Giving cost?</h2>
          <p className="text-gray-11 leading-relaxed max-w-2xl text-pretty">
            There is no platform fee while the optional donor contribution stays
            on. Turning that ask off is a 1.5% fee. At checkout, donors can add
            an optional contribution to Better Giving. It's always{" "}
            <strong className="text-gray-12">
              opt-in and never pre-selected
            </strong>
            . That keeps the commons free for every nonprofit. And third-party
            processing fees? Most donors choose to cover them, so the vast
            majority of every gift reaches you.
          </p>
          <div className="card max-w-xl">
            <p className="text-sm/relaxed text-gray-11 text-pretty">
              <strong className="text-gray-12">
                Prefer no contribution ask on your form?
              </strong>{" "}
              You can opt out of the donor-contribution model in favor of a
              simple 1.5% platform fee, your choice, always.
            </p>
          </div>
        </div>
      </div>

      <CtaBand
        title="Keep every dollar working for your mission"
        subtitle="No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee."
      />
    </main>
  );
}
