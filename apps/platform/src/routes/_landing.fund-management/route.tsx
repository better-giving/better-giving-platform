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
    n: "1",
    title: "Choose your split",
    body: "e.g. 80% granted to your bank, 15% savings, 5% Sustainability Fund. Whatever fits your needs.",
  },
  {
    n: "2",
    title: "Donations route automatically",
    body: "Every gift (card, stock, crypto, DAF) follows your split with no extra admin.",
  },
  {
    n: "3",
    title: "Watch reserves build",
    body: "Track balances in your dashboard. Savings withdrawals are paid out every 3 days once your balance reaches your payout minimum, and Sustainability Fund withdrawals are reviewed before payout.",
  },
] as const;

export default function Page() {
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-16 pb-20">
        <div className="page grid gap-12 lg:grid-cols-[1.1fr_0.9fr] items-center">
          <div className="grid gap-5 justify-items-start">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">
              Fund Management
            </p>
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
              <Link
                to={href("/register")}
                className="btn btn-lg btn-primary shadow-lift-cta"
              >
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
          <div className="grid gap-6 md:grid-cols-3 mt-12">
            {split_steps.map((s) => (
              <div
                key={s.n}
                className="grid gap-2.5 justify-items-center text-center content-start"
              >
                <span
                  className="size-13 rounded-full bg-secondary text-gray-12 grid place-items-center text-xl font-bold"
                  aria-hidden
                >
                  {s.n}
                </span>
                <span className="text-xl font-bold">{s.title}</span>
                <p className="text-sm/relaxed text-gray-11 max-w-75">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand
        title="Start building your reserve today"
        subtitle="Grant, save, or invest each donation. Returns vary, and past performance isn't a guarantee."
      />
    </main>
  );
}
