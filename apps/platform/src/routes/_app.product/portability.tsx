import { EMAILS } from "@better-giving/brand";

const promises = [
  {
    n: "1",
    title: "Your data belongs to you",
    body: "Every record, full giving history, exportable anytime via CSV or API, free.",
  },
  {
    n: "2",
    title: "Recurring donors are portable",
    body: "We actively facilitate migrating recurring-donor payment records to your new processor.",
  },
  {
    n: "3",
    title: "No exit toll",
    body: "Never conditioned on fees or new terms. Data in 5 business days, migration underway in 10.",
  },
] as const;

interface IPortability {
  classes?: string;
}

export function Portability({ classes = "" }: IPortability) {
  return (
    <section className={classes} aria-labelledby="portability-heading">
      <div className="page">
        <p className="text-xs font-bold uppercase tracking-wider text-primary text-center">
          No lock-in
        </p>
        <h2
          id="portability-heading"
          className="section-heading text-center mt-3 max-w-3xl mx-auto"
        >
          Your donors are yours, including your recurring donors
        </h2>
        <p className="mt-3.5 text-gray-11 text-center max-w-2xl mx-auto text-pretty">
          Most platforms let you export a spreadsheet, but hold your monthly
          card-on-file donors hostage. We make the opposite promise, the{" "}
          <strong className="text-gray-12">
            Recurring-Donor Portability Guarantee
          </strong>
          :
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-11">
          {promises.map((p) => (
            <div key={p.n} className="card shadow-lift-card">
              <span className="block text-3xl font-bold text-primary">
                {p.n}
              </span>
              <span className="block font-bold mt-2 mb-1.5">{p.title}</span>
              <span className="text-sm/normal text-gray-11">{p.body}</span>
            </div>
          ))}
        </div>
        <p className="mt-7 text-sm/relaxed text-gray-11 text-center max-w-3xl mx-auto text-pretty">
          Honest fine print: whether a stored card credential can transfer
          directly depends on card-network rules, PCI-DSS, and your new
          processor. Where a direct transfer isn't permitted, we hand over the
          full recurring-gift schedule and support a re-authorization campaign.
          We will never be the obstacle. Invoke it anytime:{" "}
          <a href={`mailto:${EMAILS.support}`} className="font-bold link">
            {EMAILS.support}
          </a>
        </p>
      </div>
    </section>
  );
}
