import { GlobeIcon, LayoutPanelLeftIcon, SproutIcon } from "lucide-react";
import { href, NavLink } from "react-router";

export function Items({ classes = "" }) {
  return (
    <div className={`${classes} grid md:grid-cols-3 gap-8`}>
      <article className="card grid justify-items-center">
        <LayoutPanelLeftIcon aria-hidden="true" />
        <h3 className="mt-2 capitalize text-center font-bold text-lg md:text-xl">
          All-in one donation form
        </h3>
        <p className="text-center mt-4">
          Raise more with a conversion-optimized form-cash, stock, and crypto in
          one flow.
        </p>
        <NavLink to={href("/donation-forms")} className="mt-4 link">
          Learn more about donation forms
        </NavLink>
      </article>
      <article className="card grid justify-items-center">
        <SproutIcon className="stroke-success icon-2xl" aria-hidden="true" />
        <h3 className="mt-2 capitalize text-center font-bold text-lg md:text-xl">
          Sustainability fund management
        </h3>
        <p className="text-center mt-4">
          Turn today's gifts into tomorrow's reserves with Savings and a pooled
          Growth Fund.
        </p>
        <NavLink to={href("/fund-management")} className="mt-4 link">
          Learn more about fund management
        </NavLink>
      </article>
      <article className="card grid justify-items-center">
        <GlobeIcon className="stroke-primary" aria-hidden="true" />
        <h3 className="mt-2 capitalize text-center font-bold text-lg md:text-xl">
          Fiscal sponsorship
        </h3>
        <p className="text-center mt-4">
          Accept U.S. tax-deductible donations globally without legal or tax
          barriers.
        </p>
        <NavLink to={href("/fiscal-sponsorship")} className="mt-4 link">
          Learn more about fiscal sponsorship
        </NavLink>
      </article>
    </div>
  );
}
