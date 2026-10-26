import { ExtLink, Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_shake_hands_x2 from "#/assets/laira/laira-shaking-hands-x2.webp";
import { app_name, base_url } from "#/constants/env";
import { BOOK_A_DEMO } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/fiscal-sponsorship")}`,
    title: `Fiscal Sponsorship | ${app_name}`,
    description: `As a U.S. 501(c)(3), ${app_name} accepts tax-deductible gifts and grants on your behalf. Reach U.S. donors and foundations without your own 501(c)(3), for a 2.9% fee.`,
  });

// striped bar mirrors the donut pattern in _landing._index/grow-funds: tokens via css vars
const market_bar_bg = `repeating-linear-gradient(
  45deg,
  var(--color-secondary),
  var(--color-secondary) 8px,
  var(--color-border) 8px,
  var(--color-border) 16px
)`;

const audiences = [
  {
    title: "Organizations outside the U.S.",
    body: "Grassroots and established nonprofits abroad often can't access IRS tax-exempt status, which shuts them out of U.S. donors and foundation grants. We bridge that gap: your U.S. supporters give tax-deductibly, we handle the legal and tax complexity, and grant the funds to you.",
  },
  {
    title: "U.S. groups without a 501(c)(3)",
    body: "New projects and community initiatives can start accepting tax-deductible donations right away: no incorporation, no year-long IRS wait. When you're ready to stand on your own, your donors and data go with you.",
  },
] as const;

const steps = [
  {
    title: "Register your organization",
    body: "Apply online. We review your eligibility.",
  },
  {
    title: "We receive gifts on your behalf",
    body: "Donors give through your branded form (every gift type) with automatic U.S. tax receipts.",
  },
  {
    title: "We grant funds to you",
    body: "Grants are paid out every 3 days once your balance reaches your payout minimum, and you can keep a share in savings or the Sustainability Fund.",
  },
] as const;

export default function Page() {
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-16 pb-20">
        <div className="page grid gap-12 lg:grid-cols-[1.1fr_0.9fr] items-center">
          <div className="grid gap-5 justify-items-start">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">
              Fiscal Sponsorship
            </p>
            <h1 className="hero-heading">
              Unlock U.S. donors, wherever you are
            </h1>
            <p className="text-lg/relaxed text-gray-11 max-w-lg text-pretty">
              As a U.S. 501(c)(3), Better Giving accepts tax-deductible gifts
              and grants on your behalf, so organizations abroad, or without
              their own 501(c)(3), can reach U.S. donors and foundations without
              incorporating.
            </p>
            <div className="flex max-sm:flex-col max-sm:w-full sm:flex-wrap sm:items-center gap-3.5 mt-1.5">
              <Link
                to={href("/register")}
                className="btn btn-lg btn-primary shadow-lift-cta"
              >
                Apply online
              </Link>
              <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-secondary">
                Book a demo
              </ExtLink>
            </div>
          </div>
          <Image
            src={laira_shake_hands_x2}
            width={420}
            alt="Two Lairas shaking hands"
            className="max-w-full justify-self-center"
          />
        </div>
      </div>

      <div className="page py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="section-heading text-center max-w-2xl mx-auto text-pretty">
            2.9%, the lowest sponsorship fee we know of
          </h2>
          <p className="mt-3.5 text-gray-11 text-center max-w-xl mx-auto text-pretty">
            Typical fiscal sponsors charge 4-10% (as of 2026). Ours covers the
            real costs of compliance and granting, and we're working to make it
            donor-coverable, so you'd keep 100%.
          </p>
          <div className="grid gap-4 mt-11">
            <div className="grid sm:grid-cols-[220px_1fr] gap-x-5 gap-y-1.5 items-center">
              <span className="font-bold sm:text-right">Better Giving</span>
              <div className="flex items-center gap-3">
                <div className="w-[29%] h-9.5 rounded bg-primary" />
                <span className="text-lg font-bold">2.9%</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-[220px_1fr] gap-x-5 gap-y-1.5 items-center">
              <span className="text-gray-11 sm:text-right">
                Typical market range (as of 2026)
              </span>
              <div className="flex items-center gap-3">
                <div
                  className="w-[70%] h-9.5 rounded"
                  style={{ background: market_bar_bg }}
                />
                <span className="text-lg font-bold text-gray-11">4-10%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-band py-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            Who fiscal sponsorship is for
          </h2>
          <div className="grid gap-6 md:grid-cols-2 mt-11">
            {audiences.map((a) => (
              <div
                key={a.title}
                className="card-on-band shadow-lift-card grid gap-2.5 content-start"
              >
                <span className="text-xl font-bold">{a.title}</span>
                <p className="text-sm/relaxed text-gray-11">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="py-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            How it works
          </h2>
          <div className="grid gap-6 md:grid-cols-3 mt-12">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="grid gap-2.5 justify-items-center text-center content-start"
              >
                <span
                  className="size-13 rounded-full bg-secondary text-gray-12 grid place-items-center text-xl font-bold"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="text-xl font-bold">{s.title}</span>
                <p className="text-sm/relaxed text-gray-11 max-w-75">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <CtaBand
        title="Open the door to U.S. giving"
        subtitle="Raise tax-deductible U.S. donations through Better Giving."
      />
    </main>
  );
}
