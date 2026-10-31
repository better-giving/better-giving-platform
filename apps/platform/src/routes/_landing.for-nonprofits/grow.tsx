import { href, Link } from "react-router";

const accounts = [
  {
    name: "Current account",
    detail: "Grants paid out to your bank once you reach your payout minimum",
    figure: "Every 3 days",
    figure_classes: "",
  },
  {
    name: "Savings account",
    detail: "High-yield reserves",
    figure: "Returns vary",
    figure_classes: "text-success-subtle-fg",
  },
  {
    name: "Sustainability Fund",
    detail: "Long-term diversified investment",
    figure: "Returns vary",
    figure_classes: "text-success-subtle-fg",
  },
] as const;

interface IGrow {
  classes?: string;
}

export function Grow({ classes = "" }: IGrow) {
  return (
    <section className={classes} aria-labelledby="grow-heading">
      <div className="page grid gap-9 lg:gap-14 lg:grid-cols-2 items-center">
        <div>
          <h2 id="grow-heading" className="section-heading">
            Don't just raise it. Grow it.
          </h2>
          <p className="mt-4 text-gray-11 text-pretty">
            Every donation can be split automatically between funds you control:
            spend now, build reserves, or invest for the long term. It's how
            small nonprofits build the three to six months of operating reserves
            the strong ones have.
          </p>
          <p className="mt-4 text-gray-11">
            You set the split once. We handle the rest.
          </p>
          <Link
            to={href("/fund-management")}
            className="inline-block mt-6 font-semibold link"
          >
            See how fund management works
          </Link>
        </div>

        <div>
          <div className="bg-card rounded-card shadow-lift-card divide-y divide-hairline overflow-hidden">
            {accounts.map((a) => (
              <div
                key={a.name}
                className="flex justify-between items-center gap-4 p-4"
              >
                <div>
                  <div className="text-sm font-bold">{a.name}</div>
                  <div className="text-xs text-gray-11">{a.detail}</div>
                </div>
                <div
                  className={`text-sm font-bold whitespace-nowrap figures ${a.figure_classes}`}
                >
                  {a.figure}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-11">
            Returns vary, and past performance isn't a guarantee. Allocations
            are always your choice.
          </p>
        </div>
      </div>
    </section>
  );
}
