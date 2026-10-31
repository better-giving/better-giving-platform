const steps = [
  {
    title: "A U.S. donor gives through your form",
    body: "Cards, bank, stocks, DAFs, or crypto, through your branded donation form. The gift is made to Better Giving, earmarked for you.",
  },
  {
    title: "Receipt, due diligence, and reporting handled",
    body: "The donor gets a U.S. tax-deductible receipt. We handle due diligence and record-keeping.",
  },
  {
    title: "Funds granted to your organization",
    body: "We grant the funds to you after the 2.9% fiscal sponsorship fee. Track everything in your dashboard, and split into savings or long-term funds if you choose.",
  },
] as const;

export function HowItWorks({ classes = "" }) {
  return (
    <section className={classes}>
      <div className="page">
        <h2 className="section-heading">Fiscal sponsorship in three steps</h2>
        <p className="section-body text-gray-11 max-w-3xl mt-3 mb-9">
          Your donors give to Better Giving, a U.S. 501(c)(3), earmarked for
          your organization. They get a U.S. tax deduction. You get the funds.
        </p>
        <ol className="bg-card rounded-card shadow-card divide-y divide-hairline">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex gap-3.5 md:gap-6 items-start p-5 md:p-6"
            >
              <span
                className="w-10 md:w-16 shrink-0 text-3xl md:text-4xl font-bold leading-none text-primary figures slashed-zero"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="grid gap-2 min-w-0">
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="text-sm/relaxed text-gray-11 text-pretty max-w-prose">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
