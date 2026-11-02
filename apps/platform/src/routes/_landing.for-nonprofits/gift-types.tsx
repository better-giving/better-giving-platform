const gift_types = [
  "Cards",
  "Bank (ACH)",
  "Stocks",
  "DAFs",
  "Crypto",
  "Recurring",
] as const;

interface IGiftTypes {
  classes?: string;
}

export function GiftTypes({ classes = "" }: IGiftTypes) {
  return (
    <section className={classes} aria-labelledby="gift-types-heading">
      <div className="page">
        <h2 id="gift-types-heading" className="section-heading">
          Every gift type. One free platform.
        </h2>
        <p className="mt-3 max-w-3xl text-lg text-gray-11 text-pretty">
          Most platforms charge 2% to 5%, or gate gift types behind paid tiers.
          Better Giving includes every gift type. Donors can cover processing or
          add an optional contribution. It is opt-in and starts off. Turning
          that ask off is a 1.5% fee.
        </p>

        <div className="grid gap-5 mt-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr]">
          <div className="card md:col-span-2 lg:col-span-1 lg:row-span-2 flex flex-col justify-center">
            <h3 className="text-2xl">Accept every gift type</h3>
            <p className="mt-3 max-w-md leading-relaxed text-gray-11 text-pretty">
              One embeddable donation form for everything your donors want to
              give.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {gift_types.map((g) => (
                <span
                  key={g}
                  className="text-sm font-semibold bg-secondary text-gray-12 rounded px-3 py-1.5"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>

          <div className="card flex flex-col justify-center">
            <h3 className="text-lg">Own your donors</h3>
            <p className="mt-2 text-base/relaxed text-gray-12 text-pretty">
              Your donor data belongs to you, full stop. No unauthorized
              listings, no marketing to your donors, no lock-in. Nonprofit
              consent is principle #1, and we live it.
            </p>
          </div>

          <div className="card flex flex-col justify-center">
            <h3 className="text-lg">Add the form to your site</h3>
            <p className="mt-2 text-base/relaxed text-gray-12 text-pretty">
              Embed the form and connect your bank from the dashboard. Tax
              receipts and donor records are handled in the platform.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
