import { ExtLink, Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_presentation from "#/assets/laira/laira-presentation-hd.webp";
import { app_name, base_url } from "#/constants/env";
import { BOOK_A_DEMO } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";
import { AllocationGovernance } from "./allocation-governance";
import { GrowPlaces } from "./grow-places";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/fund-management")}`,
    title: `Fund Management | ${app_name}`,
    description:
      "Grant, save, or invest each donation your way. Returns vary, and past performance isn't a guarantee.",
  });

const split_steps = [
  {
    title: "Choose your split",
    body: "e.g. 80% granted to your bank, 15% savings, 5% Sustainability Fund. Whatever fits your needs.",
  },
  {
    title: "Donations route automatically",
    body: "Every gift (card, stock, crypto, DAF) follows your split with no extra admin.",
  },
  {
    title: "Watch reserves build",
    body: "Track balances in your dashboard. Savings withdrawals are paid out every 3 days once your balance reaches your payout minimum. Sustainability Fund withdrawals are reviewed before payout.",
  },
] as const;

export const handle = { markdown: true };

export default function Page() {
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-16 pb-20">
        <div className="page grid gap-12 lg:grid-cols-[1.2fr_0.8fr] items-center">
          <div className="grid gap-5 justify-items-start">
            <h1 className="hero-heading">
              This quarter's gifts, next decade's reserves
            </h1>
            <p className="text-lg/relaxed text-gray-11 max-w-lg text-pretty">
              Choose what share of each donation is granted to your bank, held
              in high-yield savings, or invested in the Sustainability Fund.
              Change the split anytime. Returns vary, and past performance isn't
              a guarantee.
            </p>
            <div className="flex max-sm:flex-col max-sm:w-full sm:flex-wrap sm:items-center gap-3.5 mt-1.5">
              <Link to={href("/register")} className="btn btn-lg btn-primary">
                Join free forever
              </Link>
              <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-secondary">
                Book a demo
              </ExtLink>
            </div>
          </div>
          <Image
            src={laira_presentation}
            width={420}
            alt="Laira presenting a growth chart"
            className="justify-self-center max-w-full"
          />
        </div>
      </div>

      <GrowPlaces classes="py-24" />
      <AllocationGovernance classes="bg-band py-24" />

      <section className="py-24" aria-labelledby="split-steps-heading">
        <div className="page">
          <h2
            id="split-steps-heading"
            className="section-heading text-center max-w-2xl mx-auto"
          >
            Set your split once. We handle the rest.
          </h2>
          <ol className="grid gap-6 md:grid-cols-3 mt-12 max-w-5xl mx-auto">
            {split_steps.map((s) => (
              <li key={s.title} className="grid gap-2.5 content-start">
                <span className="text-xl font-bold">{s.title}</span>
                <p className="text-base/relaxed text-gray-12">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CtaBand
        title="Start building your reserve today"
        subtitle="Grant, save, or invest each donation. Returns vary, and past performance isn't a guarantee."
      />
    </main>
  );
}
