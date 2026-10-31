import { Check as CheckIcon } from "lucide-react";
import { href, Link } from "react-router";

interface ICheck {
  children: React.ReactNode;
  /** on-navy featured card uses success accent for contrast */
  dark?: boolean;
}

function Check({ children, dark }: ICheck) {
  return (
    <span className="flex gap-2.5 text-sm/normal">
      <CheckIcon
        className={`flex-none icon-md mt-0.5 ${dark ? "text-success" : "text-primary"}`}
        strokeWidth={3}
        aria-hidden
      />
      {children}
    </span>
  );
}

interface IPriceCards {
  classes?: string;
}

export function PriceCards({ classes = "" }: IPriceCards) {
  return (
    <div className={`${classes}`}>
      <div className="page grid gap-6 md:grid-cols-2">
        <div className="bg-primary rounded p-8 flex flex-col gap-3.5 shadow-lift-cta text-primary-fg">
          <span className="text-lg font-bold">
            Fundraising &amp; fund management
          </span>
          <span className="text-5xl font-bold">
            $0
            <span className="text-base font-normal text-primary-fg/90">
              {" "}
              (all features included)
            </span>
          </span>
          <div className="grid gap-2 text-primary-fg/90">
            <Check dark>Donation form, every gift type, embedding</Check>
            <Check dark>
              Recurring giving, peer-to-peer, receipts &amp; reporting
            </Check>
            <Check dark>
              High-yield savings &amp; Sustainability Fund. Returns vary, and
              past performance isn't a guarantee.
            </Check>
            <Check dark>Full donor data, exports, portability guarantee</Check>
          </div>
          <Link to={href("/register")} className="btn btn-secondary mt-auto">
            Join free forever
          </Link>
        </div>

        <div className="card flex flex-col gap-3.5">
          <span className="text-lg font-bold">Fiscal sponsorship</span>
          <span className="text-5xl font-bold">
            2.9%
            <span className="text-base font-normal text-gray-11">
              {" "}
              per sponsored gift
            </span>
          </span>
          <div className="grid gap-2">
            <Check>
              Tax-deductible U.S. giving for orgs abroad or without a 501(c)(3)
            </Check>
            <Check>Compliance, receipts &amp; granting handled</Check>
            <Check>
              Market rate is 4-10% as of 2026, and we're working to make ours
              donor-coverable
            </Check>
          </div>
          <Link
            to={href("/fiscal-sponsorship")}
            className="btn btn-secondary mt-auto"
          >
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}
