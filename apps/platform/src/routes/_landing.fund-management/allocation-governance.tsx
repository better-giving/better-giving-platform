import { ArrowLeftRight, Scale } from "lucide-react";

const allocation = [
  { pct: "50%", label: "U.S. equities", swatch: "bg-primary" },
  { pct: "10%", label: "non-U.S. equities", swatch: "bg-primary/65" },
  { pct: "32.5%", label: "fixed income", swatch: "bg-primary/30" },
  { pct: "7.5%", label: "metals", swatch: "bg-warning" },
] as const;

// conic segments mirror the legend swatches: token opacities ≈ white mixes
const donut_bg = `conic-gradient(
  var(--color-primary) 0% 50%,
  color-mix(in srgb, var(--color-primary) 65%, white) 50% 60%,
  color-mix(in srgb, var(--color-primary) 30%, white) 60% 92.5%,
  var(--color-warning) 92.5% 100%
)`;

const pillars = [
  {
    icon: <Scale className="icon-xl" />,
    title: "Investment-committee governed",
    body: "Professional oversight of strategy and risk, rebalanced quarterly to the target allocation.",
  },
  {
    icon: <ArrowLeftRight className="icon-xl" />,
    title: "Your money stays yours",
    body: "Adjust your grant, save, or invest split anytime. Grants and savings withdrawals are paid out every 3 days once your balance reaches your payout minimum. Sustainability Fund withdrawals are reviewed before payout.",
  },
];

interface IAllocationGovernance {
  classes?: string;
}

export function AllocationGovernance({ classes = "" }: IAllocationGovernance) {
  return (
    <section className={classes} aria-labelledby="governance-heading">
      <div className="page grid gap-14 lg:grid-cols-2 items-center">
        <div className="card-on-band shadow-lift-card grid gap-6 justify-items-center">
          <span className="text-lg font-bold">Target allocation</span>
          <div
            className="size-55 rounded-full grid place-items-center"
            style={{ background: donut_bg }}
            role="img"
            aria-label="Target allocation: 50% U.S. equities, 10% non-U.S. equities, 32.5% fixed income, 7.5% metals"
          >
            <div className="size-32.5 rounded-full bg-surface grid place-items-center text-center">
              <div>
                <span className="block text-lg font-bold">Target mix</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-7 gap-y-2.5 text-sm">
            {allocation.map((a) => (
              <span key={a.label} className="flex items-center gap-2">
                <span
                  className={`size-3 rounded ${a.swatch} inline-block`}
                  aria-hidden
                />
                {a.pct} {a.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-5 content-start">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Governance
          </p>
          <h2 id="governance-heading" className="section-heading">
            Managed like an endowment, open like a commons
          </h2>
          <div className="grid gap-3.5">
            {pillars.map((p) => (
              <div
                key={p.title}
                className="card-on-band flex gap-3.5 items-start"
              >
                <span
                  className="flex-none size-9.5 rounded bg-secondary grid place-items-center font-bold"
                  aria-hidden
                >
                  {p.icon}
                </span>
                <div>
                  <span className="font-bold">{p.title}</span>
                  <p className="mt-0.5 text-sm/normal text-gray-11">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
