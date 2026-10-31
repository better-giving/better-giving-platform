import type { ReactNode } from "react";

interface Cost {
  amount: string;
  effective: string;
}

interface Row {
  sponsor: string;
  note?: string;
  fee: string;
  on_100k: Cost | string;
  on_250k: Cost | string;
  minimum: ReactNode;
  published: ReactNode;
}

const bg: Row = {
  sponsor: "Better Giving",
  note: "Fiscally sponsored partner fund",
  fee: "2.9% all-in, flat. No setup or monthly fees.",
  on_100k: { amount: "$2,900", effective: "2.9% effective" },
  on_250k: { amount: "$7,250", effective: "2.9% effective" },
  minimum: (
    <span className="inline-block text-xs uppercase tracking-badge font-bold text-warning-fg bg-warning rounded px-1.5 py-0.5">
      Confirm
    </span>
  ),
  published: <span className="text-success-subtle-fg font-bold">Yes</span>,
};

const others: Row[] = [
  {
    sponsor: "Myriad USA",
    note: "formerly KBFUS; merged with Give2Asia",
    fee: "Tiered on annual contributions: 5% of the first $100K, 3% of the next $400K, 1% of the next $500K, 0.5% above $1M.",
    on_100k: { amount: "$5,000", effective: "5.0% effective" },
    on_250k: { amount: "$9,500", effective: "3.8% effective" },
    minimum: "$5,000 fund balance",
    published: <span className="text-success-subtle-fg font-bold">Yes</span>,
  },
  {
    sponsor: "Give2Asia",
    note: "Friends Fund program",
    fee: "Contribution-based management fee scaled to cumulative annual donations. No annual fee. Rate not published as a flat figure.",
    on_100k: "Quote required",
    on_250k: "Quote required",
    minimum: "$5,000 (Hong Kong, Taiwan) · $10,000 (mainland China)",
    published: (
      <span className="text-destructive-subtle-fg font-semibold">
        Not published
      </span>
    ),
  },
  {
    sponsor: "Community Initiatives",
    note: "Comprehensive fiscal sponsorship",
    fee: "10% of gross receipts; 15% on government funds.",
    on_100k: { amount: "$10,000", effective: "10% effective" },
    on_250k: { amount: "$25,000", effective: "10% effective" },
    minimum: "$24,000 minimum annual fundraising required",
    published: <span className="text-success-subtle-fg font-bold">Yes</span>,
  },
  {
    sponsor: "CAF America",
    note: "Foreign nonprofit grant eligibility",
    fee: "Fees quoted after a Grant Eligibility Application. No public rate card for sponsored organizations.",
    on_100k: "Quote required",
    on_250k: "Quote required",
    minimum: "Varies by agreement",
    published: (
      <span className="text-destructive-subtle-fg font-semibold">
        Not published
      </span>
    ),
  },
];

const benchmark: Row = {
  sponsor: "Sector benchmark",
  fee: "Independent guides put typical administrative fees at 5-15% of funds raised, with 10% a common starting point.",
  on_100k: "$5,000-$15,000",
  on_250k: "$12,500-$37,500",
  minimum: "Commonly imposed",
  published: "Varies widely",
};

function CostCell({ cost, accent }: { cost: Cost | string; accent?: boolean }) {
  if (typeof cost === "string")
    return <span className="text-gray-11">{cost}</span>;
  return (
    <>
      <span
        className={`block font-bold ${accent ? "text-success-subtle-fg" : ""}`}
      >
        {cost.amount}
      </span>
      <span className="block text-xs text-gray-11">{cost.effective}</span>
    </>
  );
}

function Cells({ row, accent }: { row: Row; accent?: boolean }) {
  return (
    <>
      {/* .table's th rule paints every header on the dim rung, which is right
          for the column strip and wrong for the row's own name */}
      <th scope="row" className="align-top text-gray-12">
        <span className="block font-bold">{row.sponsor}</span>
        {row.note && (
          <span className="block text-xs font-normal text-gray-11">
            {row.note}
          </span>
        )}
      </th>
      <td className="align-top">{row.fee}</td>
      <td className="align-top">
        <CostCell cost={row.on_100k} accent={accent} />
      </td>
      <td className="align-top">
        <CostCell cost={row.on_250k} accent={accent} />
      </td>
      <td className="align-top">{row.minimum}</td>
      <td className="align-top">{row.published}</td>
    </>
  );
}

export function RateComparison({ classes = "" }) {
  return (
    <section id="compare" className={classes}>
      <div className="page">
        <h2 className="section-heading">How we compare on published rates</h2>
        <p className="section-body text-gray-11 max-w-4xl mt-3 mb-8">
          Every figure below comes from the sponsor's own published fee
          schedule, linked at the bottom. Where a sponsor doesn't publish a
          rate, we say so rather than guess. You should ask them directly, and
          you should expect an answer.
        </p>

        <p className="lg:hidden text-xs text-gray-11 mb-2">
          Scroll the table sideways for every column.
        </p>
        {/* focusable region: the only way to reach a scroll container without a
            pointer, and the label is what tells a screen reader what it holds */}
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 — a scroll container is otherwise reachable only by pointer
          tabIndex={0}
          aria-label="Fiscal sponsor rate comparison"
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <table className="table min-w-225">
            <thead>
              <tr>
                <th scope="col" className="min-w-45">
                  Sponsor
                </th>
                <th scope="col" className="min-w-55">
                  Published fee
                </th>
                <th scope="col" className="min-w-30">
                  Cost on $100K
                </th>
                <th scope="col" className="min-w-30">
                  Cost on $250K
                </th>
                <th scope="col" className="min-w-40">
                  Minimum to get paid out
                </th>
                <th scope="col" className="min-w-32">
                  Rate published publicly
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-secondary text-gray-12">
                <Cells row={bg} accent />
              </tr>
              {others.map((r) => (
                <tr key={r.sponsor}>
                  <Cells row={r} />
                </tr>
              ))}
              <tr className="bg-gray-3 text-gray-11">
                <Cells row={benchmark} />
              </tr>
            </tbody>
          </table>
        </section>

        <p className="mt-5 text-xs/relaxed text-gray-11 max-w-5xl">
          <span className="font-bold text-gray-12">
            Sources, verified August 2026:
          </span>{" "}
          Myriad USA published fee schedule (myriadusa.org), Give2Asia donor FAQ
          and Fidelity Charitable partner profile, Community Initiatives fees
          and minimums page, CAF America foreign nonprofits page, Sector
          benchmark from Propel Nonprofits (5-10%), Nonprofit Association of
          Oregon (7-15%), and Giddings Consulting (5-15%). Rates change. If you
          find one of these out of date, tell us and we'll correct it.
          Third-party payment processing costs are separate for every sponsor
          listed, including us.
        </p>
      </div>
    </section>
  );
}
