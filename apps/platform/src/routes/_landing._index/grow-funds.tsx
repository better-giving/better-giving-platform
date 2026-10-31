import { PercentIcon, TrendingUpIcon } from "lucide-react";

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

interface IGrowFunds {
  classes?: string;
}

export function GrowFunds({ classes = "" }: IGrowFunds) {
  return (
    <section className={classes} aria-labelledby="grow-funds-heading">
      <div className="page grid gap-14 lg:grid-cols-2 items-center">
        <div className="grid gap-5 content-start">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Grow your funds
          </p>
          <h2 id="grow-funds-heading" className="section-heading">
            This quarter's gifts, next decade's reserves
          </h2>
          <p className="text-gray-11 text-pretty">
            Route any share of your donations into two places money grows:
          </p>
          <div className="grid gap-3.5">
            <div className="card flex gap-3.5 items-start">
              <span className="flex-none size-9.5 rounded bg-secondary grid place-items-center font-bold">
                <PercentIcon aria-hidden className="icon-xl" />
              </span>
              <div>
                <span className="font-bold">High-yield savings</span>
                <p className="mt-0.5 text-sm/normal text-gray-11">
                  FDIC-insured. Withdrawals are paid out every 3 days once your
                  balance reaches your payout minimum.
                </p>
              </div>
            </div>
            <div className="card flex gap-3.5 items-start">
              <span className="flex-none size-9.5 rounded bg-secondary grid place-items-center font-bold">
                <TrendingUpIcon aria-hidden className="icon-xl" />
              </span>
              <div>
                <span className="font-bold">Sustainability Fund</span>
                <p className="mt-0.5 text-sm/normal text-gray-11">
                  Professionally managed, investment-committee governed,
                  rebalanced quarterly.
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-11">
            Returns vary, and past performance isn't a guarantee.
          </p>
        </div>

        <div className="card shadow-lift-card grid gap-6 justify-items-center">
          <span className="text-lg font-bold">
            Sustainability Fund target allocation as of 2026
          </span>
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
      </div>
    </section>
  );
}
