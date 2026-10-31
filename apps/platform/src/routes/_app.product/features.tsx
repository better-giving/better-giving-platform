const features = [
  {
    title: "Recurring donations",
    body: "Stabilize revenue with automated monthly giving.",
  },
  {
    title: "Customizable & embeddable",
    body: "Your brand colors, your wording, on your website.",
  },
  {
    title: "Global donor access",
    body: "Localized, multi-currency giving worldwide.",
  },
  {
    title: "Goal-tracking progress bars",
    body: "Show real-time progress to motivate donors.",
  },
  {
    title: "Peer-to-peer fundraising",
    body: "Every supporter can crowdfund on your behalf.",
  },
  {
    title: "Dedication gifts",
    body: "Donors dedicate gifts to someone special.",
  },
  {
    title: "Donors cover processing fees",
    body: "Most donors opt to cover fees, so more of every gift reaches you.",
  },
  {
    title: "Program-specific giving",
    body: "Let donors fund the programs they care about.",
  },
  {
    title: "Automated receipts & reporting",
    body: "Branded tax receipts and reporting, handled for you.",
  },
] as const;

interface IFeatures {
  classes?: string;
}

export function Features({ classes = "" }: IFeatures) {
  return (
    <section className={classes} aria-labelledby="features-heading">
      <div className="page">
        <h2
          id="features-heading"
          className="section-heading text-center max-w-2xl mx-auto"
        >
          Smarter tools for simpler fundraising
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-11">
          {features.map((f) => (
            <div key={f.title} className="card shadow-lift-card">
              <span className="block font-bold mb-1.5">{f.title}</span>
              <span className="text-sm/normal text-gray-11">{f.body}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
