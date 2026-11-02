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
          <div className="card grid gap-3.5 content-start">
            <div className="grid gap-1">
              <h3 className="text-2xl font-bold">High-yield savings</h3>
              <p className="text-gray-11">No market risk</p>
            </div>
            <p className="text-base/relaxed text-gray-12">
              FDIC-insured. A reliable way to build reserves while funds stay
              safe and liquid. Withdrawals are paid out every 3 days once your
              balance reaches your payout minimum.
            </p>
          </div>
          <div className="surface-primary rounded-card p-9 grid gap-3.5 content-start">
            <div className="grid gap-1">
              <h3 className="text-2xl font-bold">Sustainability Fund</h3>
              <p className="text-primary-fg/90">Long-term growth</p>
            </div>
            <p className="text-base/relaxed">
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
