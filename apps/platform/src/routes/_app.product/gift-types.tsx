const gift_types = [
  { title: "Card", body: "Credit & debit, with express checkout" },
  { title: "Bank / ACH", body: "Lowest-fee direct transfers" },
  { title: "PayPal & Venmo", body: "One-tap for millions of donors" },
  { title: "Apple / Google Pay", body: "Express mobile checkout" },
  { title: "Stock", body: "Larger gifts, tax benefits for donors" },
  { title: "Donor-Advised Funds", body: "DAFpay via Chariot, built in" },
  { title: "IRA / QCD", body: "Qualified charitable distributions" },
  { title: "Crypto", body: "We accept crypto gifts" },
] as const;

interface IGiftTypes {
  classes?: string;
}

export function GiftTypes({ classes = "" }: IGiftTypes) {
  return (
    <section className={classes} aria-labelledby="gift-types-heading">
      <div className="page">
        <p className="text-xs font-bold uppercase tracking-wider text-primary text-center">
          Payment aggregation
        </p>
        <h2
          id="gift-types-heading"
          className="section-heading text-center mt-3 max-w-2xl mx-auto"
        >
          Every way to give, in one flow
        </h2>
        <p className="mt-3.5 text-gray-11 text-center max-w-2xl mx-auto text-pretty">
          Stop turning donors away. One integration covers everything. No extra
          portals, no added admin. We accept stock and crypto gifts.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-11">
          {gift_types.map((g) => (
            <div key={g.title} className="card">
              <span className="block font-bold">{g.title}</span>
              <span className="text-sm/normal text-gray-11">{g.body}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
