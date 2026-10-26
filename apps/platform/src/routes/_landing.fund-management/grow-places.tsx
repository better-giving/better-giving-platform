import { Badge } from "@better-giving/ui";

interface IGrowPlaces {
  classes?: string;
}

export function GrowPlaces({ classes = "" }: IGrowPlaces) {
  return (
    <section className={classes} aria-labelledby="grow-places-heading">
      <div className="page">
        <h2
          id="grow-places-heading"
          className="section-heading text-center max-w-2xl mx-auto"
        >
          Two places your money grows
        </h2>
        <div className="grid gap-6 md:grid-cols-2 mt-11">
          <div className="bg-secondary border border-gray-6 rounded p-9 grid gap-3.5 content-start">
            <Badge size="md" tone="secondary" className="justify-self-start">
              No market risk
            </Badge>
            <h3 className="text-2xl font-bold">High-yield savings</h3>
            <p className="text-sm/relaxed text-gray-11">
              FDIC-insured. A reliable way to build reserves while funds stay
              safe and liquid. Withdrawals are paid out every 3 days.
            </p>
          </div>
          <div className="surface-primary rounded p-9 grid gap-3.5 content-start">
            <Badge size="md" tone="on-primary" className="justify-self-start">
              Long-term growth
            </Badge>
            <h3 className="text-2xl font-bold">Sustainability Fund</h3>
            <p className="text-sm/relaxed text-primary-fg/90">
              A professionally managed, pooled investment fund designed for
              long-term stability: your path to an endowment-style reserve,
              whatever your size. DAF gifts can route straight into it.
            </p>
          </div>
        </div>
        <p className="mt-5 text-xs text-gray-11 text-center">
          Returns vary, and past performance isn't a guarantee.
        </p>
      </div>
    </section>
  );
}
