import { Image } from "@better-giving/ui";
import laira_presentation from "#/assets/laira/laira-presentation.webp";
import laira_shaking_hands from "#/assets/laira/laira-shaking-hands-x2.webp";

interface IOwnGrow {
  classes?: string;
}

export function OwnGrow({ classes = "" }: IOwnGrow) {
  return (
    <section className={classes} aria-labelledby="own-grow-heading">
      <div className="page">
        <h2
          id="own-grow-heading"
          className="section-heading text-center max-w-2xl mx-auto"
        >
          Own it. Grow it.
        </h2>
        <p className="mt-3.5 text-gray-11 text-center max-w-2xl mx-auto text-pretty">
          Most platforms move your money and keep the keys. We built the
          opposite: infrastructure you can own, and reserves that grow.
        </p>
        <div className="grid gap-6 md:grid-cols-2 mt-12">
          <div className="card flex flex-col gap-4">
            <Image
              src={laira_shaking_hands}
              width={120}
              alt="Two Lairas shaking hands"
            />
            <h3 className="text-2xl font-bold">Own it.</h3>
            <p className="text-base/relaxed text-gray-11">
              Our whole stack is open source: trust you can verify in code, not
              just promises. You own the donor relationship, your data exports
              freely. And there's no lock-in, including your recurring donors:
              our{" "}
              <strong className="text-gray-12">
                Recurring-Donor Portability Guarantee
              </strong>{" "}
              means if you ever leave, we actively help migrate your recurring
              donors to your new platform, free, no exit toll.
            </p>
          </div>
          <div className="card flex flex-col gap-4">
            <Image
              src={laira_presentation}
              width={120}
              alt="Laira presenting a growth chart"
            />
            <h3 className="text-2xl font-bold">Grow it.</h3>
            <p className="text-base/relaxed text-gray-11">
              We don't just move money. We help you keep and grow it. Route any
              share of what you raise into FDIC-insured savings or a
              professionally managed Sustainability Fund, and turn this
              quarter's gifts into next decade's reserves. Returns vary, and
              past performance isn't a guarantee.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
