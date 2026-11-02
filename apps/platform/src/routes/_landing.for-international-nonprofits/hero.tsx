import { ExtLink } from "@better-giving/ui";
import { BOOK_A_DEMO } from "#/constants/urls";
import type { ILeadValues } from "@/reg/lead";
import { EligibilityForm, type IEligibilityErrors } from "./eligibility-form";

interface IHero {
  classes?: string;
  errors?: IEligibilityErrors;
  /** the last submit's posted values, mismatched session and form-level
   * message, passed straight through to the form that owns them */
  values?: ILeadValues;
  signed_in_as?: string;
  message?: string;
  pending?: boolean;
}

export function Hero({
  classes = "",
  errors,
  values,
  signed_in_as,
  message,
  pending,
}: IHero) {
  return (
    <header className={classes}>
      <div className="page grid gap-8 lg:gap-12 lg:grid-cols-[1.05fr_0.95fr] items-start">
        {/* once the columns stack the copy sits above the form rather than
            beside it, so it centers on its own axis instead of hugging a left
            edge nothing else shares */}
        <div className="grid gap-5 max-lg:justify-items-center max-lg:text-center max-lg:max-w-3xl max-lg:mx-auto lg:justify-items-start">
          <h1 className="hero-heading lg:max-w-2xl">
            Unlock U.S. donors without a 501(c)(3)
          </h1>
          <p className="section-body text-gray-11 lg:max-w-xl">
            U.S. donors give more when gifts are tax-deductible. Our fiscal
            sponsorship makes that possible at 2.9%, versus the usual 4-10% as
            of 2026.
          </p>
          {/* only while the form sits beside this copy. once the columns stack
              the form is directly below, and its own submit is the primary
              action — two "unlock U.S. donors" buttons a screen apart is one
              too many. the demo link moves inside the form to keep that door
              open. the primary targets the form's first field: a fragment
              navigation to a focusable element focuses it, and a plain <a>
              keeps the hash away from the router. */}
          <div className="max-lg:hidden flex flex-wrap gap-3">
            <a href="#o_name" className="btn btn-lg btn-primary">
              Unlock U.S. donors
            </a>
            <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-secondary">
              Book a demo
            </ExtLink>
          </div>
        </div>

        <EligibilityForm
          errors={errors}
          values={values}
          signed_in_as={signed_in_as}
          message={message}
          pending={pending}
        />
      </div>
    </header>
  );
}
