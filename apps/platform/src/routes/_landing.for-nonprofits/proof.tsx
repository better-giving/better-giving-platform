import { href, Link } from "react-router";

const points = [
  {
    title: "We've endorsed the NCN's ethical fundraising principles",
    body: "The National Council of Nonprofits published its Principles for Ethical Online Fundraising Platforms: nonprofit consent, transparency, partnership, accountability. We've endorsed all four, and we're glad we're not the only ones. The more platforms that sign, the better for the sector.",
  },
  {
    title: "Our transparency pledge goes right to the code",
    body: "Your board, your auditor, or your most skeptical donor can read the code: opt-in donor contributions, a 1.5% fee only if you turn that ask off, and donation records that export from your dashboard.",
  },
  {
    title: "The processing is public",
    body: "Your donation form runs on public code, so you can read how gifts are processed. The service you join is the managed platform.",
  },
] as const;

interface IProof {
  classes?: string;
}

export function Proof({ classes = "" }: IProof) {
  return (
    <section className={classes} aria-labelledby="proof-heading">
      <div className="page grid gap-9 lg:gap-14 lg:grid-cols-[0.85fr_1.15fr] items-start">
        <div className="lg:sticky lg:top-24">
          <h2 id="proof-heading" className="section-heading">
            Others promise transparency. Ours is checkable.
          </h2>
          <p className="mt-4 text-gray-11 text-pretty">
            We're small, and that's exactly why our transparency has to be
            provable rather than promised.
          </p>
          <Link
            to={href("/open-source")}
            className="inline-block mt-6 font-semibold link"
          >
            Have the code audited
          </Link>
        </div>

        <div className="grid divide-y divide-hairline">
          {points.map((p) => (
            <div key={p.title} className="py-8 first:pt-0 last:pb-0">
              <h3 className="text-xl leading-snug">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-gray-11 text-pretty">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
