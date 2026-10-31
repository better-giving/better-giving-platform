import { ArrowRight } from "lucide-react";
import { href, Link } from "react-router";

const pillars = [
  {
    title: "Raise more today",
    body: "A high-converting, brandable form that lives on your site. Fewer clicks, express checkout, recurring giving built in.",
    cta: "Explore the product",
    to: href("/product"),
  },
  {
    title: "Accept every kind of gift",
    body: "Card, bank, PayPal, wallets, stock, DAF, IRA, and crypto. One flow, one integration, no extra portals.",
    cta: "See every gift type",
    to: href("/product"),
  },
  {
    title: "Grow what you raise",
    body: "High-yield savings and a managed Sustainability Fund turn gifts into lasting reserves, at no cost.",
    cta: "Grow your funds",
    to: href("/fund-management"),
  },
  {
    title: "Keep more of every dollar",
    body: "No platform fee while the optional donor contribution stays on your form. It is opt-in and starts off. Turning that ask off is a 1.5% fee.",
    cta: "See pricing",
    to: href("/pricing"),
  },
  {
    title: "Go global with fiscal sponsorship",
    body: "Organizations abroad or without a 501(c)(3) can accept tax-deductible U.S. gifts through us: just 2.9%, vs the 4-10% market rate (as of 2026).",
    cta: "Unlock U.S. donors",
    to: href("/fiscal-sponsorship"),
  },
] as const;

interface IPillars {
  classes?: string;
}

export function Pillars({ classes = "" }: IPillars) {
  return (
    <section className={classes} aria-labelledby="pillars-heading">
      <div className="page">
        <h2
          id="pillars-heading"
          className="section-heading text-center text-balance max-w-2xl mx-auto"
        >
          Everything a nonprofit needs to raise, keep, and grow
        </h2>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 mt-12">
          {pillars.map((p) => (
            <div key={p.title} className="card flex flex-col gap-2.5">
              <span className="text-xl font-bold">{p.title}</span>
              <p className="text-sm/relaxed">{p.body}</p>
              <Link
                to={p.to}
                className="inline-flex items-center gap-1.5 font-bold text-sm link mt-auto pt-2"
              >
                {p.cta}
                <ArrowRight className="icon-md" />
              </Link>
            </div>
          ))}
          <div className="bg-primary rounded-card p-8 flex flex-col gap-2.5 text-primary-fg">
            <span className="text-xl font-bold">
              Open source &amp; member-powered
            </span>
            <p className="text-sm/relaxed text-primary-fg/90">
              The entire stack is public code. Read how donations are processed,
              and help keep the commons free for every nonprofit.
            </p>
            <Link
              to={href("/open-source")}
              className="inline-flex items-center gap-1.5 font-bold text-sm hover:underline mt-auto pt-2"
            >
              Read the code
              <ArrowRight className="icon-md" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
