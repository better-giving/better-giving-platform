export function FeeGap({ classes = "" }) {
  return (
    <section className={classes}>
      <div className="page">
        <h2 className="section-heading max-w-3xl">
          On a $100,000 year, the fee gap reaches $7,100.
        </h2>
        <p className="section-body text-gray-11 max-w-3xl mt-3 mb-9">
          Typical fiscal sponsors charge 4-10% of everything you raise (as of
          2026). We charge 2.9%, all-in. Same tax deduction for your donors,
          thousands more for your mission.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 max-w-3xl figures slashed-zero">
          <div className="card">
            <p className="eyebrow text-gray-11">Typical fiscal sponsor</p>
            <p className="text-5xl/tight font-bold mt-3">4-10%</p>
            <p className="text-sm text-gray-11">as of 2026</p>
            <p className="text-sm text-gray-11 mt-2">You keep</p>
            <p className="text-xl font-bold">$90,000-$96,000</p>
          </div>
          <div className="card border-2 border-primary">
            <p className="eyebrow text-primary">Better Giving</p>
            <p className="text-5xl/tight font-bold mt-3 text-primary">2.9%</p>
            <p className="text-sm text-gray-11 mt-2">You keep</p>
            <p className="text-xl font-bold text-success-subtle-fg">$97,100</p>
          </div>
        </div>

        <p className="mt-6 text-lg font-bold figures slashed-zero">
          That's $1,100-$7,100 more per year staying with your mission.
        </p>
      </div>
    </section>
  );
}
