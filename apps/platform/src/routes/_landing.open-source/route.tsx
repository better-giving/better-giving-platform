import { ExtLink, Image } from "@better-giving/ui";
import { ArrowRight } from "lucide-react";
import { href, Link } from "react-router";
import laira_waiving from "#/assets/laira/laira-waiving.webp";
import { app_name, base_url } from "#/constants/env";
import { GITHUB_REPO } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import {
  TermCmd,
  TermComment,
  TerminalCard,
  TermOk,
} from "#/pages/@sections/terminal-card";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/open-source")}`,
    title: `Open Source | ${app_name}`,
    description:
      "The Better Giving platform is public code. Read how donations are processed, and contribute code or docs if you want to help.",
  });

const why = [
  {
    title: "Verify, don't trust",
    body: "Anyone (your board, your auditor, your most skeptical donor) can inspect exactly how donations are processed, routed, and receipted.",
  },
  {
    title: "Read it, then contribute",
    body: "The repository is the managed platform: the donation form, settlement, and receipts. Reading it is how you check the path a gift takes. Contributions of code, docs, and review are welcome.",
  },
  {
    title: "A commons that outlives us",
    body: "Public code can't be bought, gated, or shut away. The community keeps the infrastructure free for every nonprofit, forever.",
  },
] as const;

export default function Page() {
  return (
    <main>
      <div className="surface-primary pt-20 pb-24">
        <div className="page grid gap-14 lg:grid-cols-[1.05fr_0.95fr] items-center">
          <div className="grid gap-5 justify-items-start">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary">
              Open Source
            </p>
            <h1 className="hero-heading text-primary-fg">Trust you can read</h1>
            <p className="text-lg/relaxed text-primary-fg/90 max-w-lg text-pretty">
              Every part of Better Giving is public code: the donation form, the
              platform, all of it. When software moves money for your mission,
              "trust us" isn't enough. Read how a donation is processed.
            </p>
            <div className="flex max-sm:flex-col max-sm:w-full sm:flex-wrap sm:items-center gap-3.5 mt-1.5">
              <ExtLink
                href={GITHUB_REPO}
                className="btn btn-lg btn-secondary gap-2"
              >
                View the repository
                <ArrowRight className="icon-md" />
              </ExtLink>
              <Link to={href("/register")} className="btn btn-lg btn-outline">
                Join free forever
              </Link>
            </div>
          </div>
          <TerminalCard label="AngelProtocolFinance / better-giving">
            <TermComment>public source for the managed platform</TermComment>
            <TermCmd>donation form, settlement, receipts</TermCmd>
            <TermComment>read how a gift is processed</TermComment>
            <TermOk>open on GitHub</TermOk>
          </TerminalCard>
        </div>
      </div>

      <div className="py-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            Why an open-source commons?
          </h2>
          <div className="grid gap-5 md:grid-cols-3 mt-11">
            {why.map((w) => (
              <div key={w.title} className="card grid gap-2.5 content-start">
                <span className="text-xl font-bold">{w.title}</span>
                <p className="text-sm/relaxed text-gray-11">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="page py-24">
        <div className="max-w-3xl mx-auto grid gap-5 justify-items-center text-center">
          <Image
            src={laira_waiving}
            width={130}
            alt="Laira waving"
            className="mb-1"
          />
          <h2 className="section-heading">How the commons stays free</h2>
          <p className="text-gray-11 leading-relaxed max-w-2xl text-pretty">
            Donors can add an optional contribution at checkout. It is opt-in
            and starts off. There is no platform fee while that ask stays on the
            form. Turning it off is a 1.5% fee. Want to contribute code, docs,
            or time? The repo is open.
          </p>
          <ExtLink
            href={GITHUB_REPO}
            className="inline-flex items-center gap-1.5 font-bold link"
          >
            Contribute on GitHub
            <ArrowRight className="icon-md" />
          </ExtLink>
        </div>
      </div>

      <CtaBand
        title="Read the code. Then join the managed platform."
        subtitle="The repository is public. Joining means the managed platform: no platform fee while the optional donor contribution stays on."
      />
    </main>
  );
}
