import { ExtLink } from "@better-giving/ui";
import { ArrowRight, Check } from "lucide-react";
import { GITHUB_REPO } from "#/constants/urls";
import {
  TermCmd,
  TermComment,
  TerminalCard,
  TermOk,
} from "#/pages/@sections/terminal-card";

const points = [
  "Verify, don't just trust: the full stack is public",
  "Read how a donation is processed, settled, and receipted",
  "Contributions of code and docs are welcome",
] as const;

interface IOpenSource {
  classes?: string;
}

export function OpenSource({ classes = "" }: IOpenSource) {
  return (
    <section className={classes} aria-labelledby="open-source-heading">
      <div className="page grid gap-14 lg:grid-cols-[1.1fr_0.9fr] items-center">
        <div className="grid gap-5 justify-items-start">
          <h2
            id="open-source-heading"
            className="section-heading text-primary-fg"
          >
            Don't take our word for it. Read the code.
          </h2>
          <p className="text-primary-fg/90 leading-relaxed text-pretty">
            Every part of Better Giving is public: the donation form, the
            platform, all of it. That means trust is verifiable, not just
            promised. Nonprofits join the managed platform.
          </p>
          <div className="grid gap-2.5 text-primary-fg font-medium text-sm">
            {points.map((p) => (
              <span key={p} className="flex items-center gap-2.5">
                <span
                  className="flex-none size-5.5 rounded-full bg-success text-success-fg grid place-items-center"
                  aria-hidden
                >
                  <Check className="icon-sm" strokeWidth={3} />
                </span>
                {p}
              </span>
            ))}
          </div>
          <ExtLink
            href={GITHUB_REPO}
            className="btn btn-lg btn-secondary gap-2 mt-2"
          >
            View the repository
            <ArrowRight className="icon-md" />
          </ExtLink>
        </div>

        <TerminalCard label="AngelProtocolFinance / better-giving">
          <TermComment>public source for the managed platform</TermComment>
          <TermCmd>donation form, settlement, receipts</TermCmd>
          <TermComment>read how a gift is processed</TermComment>
          <TermOk>open on GitHub</TermOk>
        </TerminalCard>
      </div>
    </section>
  );
}
