import { Image } from "@better-giving/ui";
import laira_sitting from "#/assets/laira/laira-sitting.webp";
import casd from "#/assets/partners/casd-sl.webp";
import fora from "#/assets/partners/for-a-day-foundation.webp";

interface ITestimonials {
  classes?: string;
}

export function Testimonials({ classes = "" }: ITestimonials) {
  return (
    <section className={classes} aria-labelledby="testimonials-heading">
      <div className="page">
        <h2 id="testimonials-heading" className="section-heading text-center">
          Nonprofits on Better Giving
        </h2>
        <div className="grid gap-6 md:grid-cols-2 mt-24">
          <div className="card flex flex-col gap-4">
            <p className="text-base/relaxed">
              "I personally like to check our BG balance weekly. Looking at the
              endowment growth week by week gives me a little spark of
              inspiration."
            </p>
            <div className="flex items-center gap-3 mt-auto">
              <img
                src={fora}
                alt=""
                className="flex-none h-11 w-auto object-contain"
                aria-hidden
              />
              <div>
                <span className="block font-bold text-sm">Jenna Edwards</span>
                <span className="text-xs text-gray-11">
                  The For a Day Foundation
                </span>
              </div>
            </div>
          </div>
          <div className="card relative flex flex-col gap-4">
            <p className="text-base/relaxed">
              "Better Giving has provided us with a powerful platform to engage
              donors, expand our reach, and make a tangible impact in the
              communities we serve in Sierra Leone."
            </p>
            <div className="flex items-center gap-3 mt-auto">
              <img
                src={casd}
                alt=""
                className="flex-none h-11 w-auto object-contain"
                aria-hidden
              />
              <div>
                <span className="block font-bold text-sm">Brima Kabbah</span>
                <span className="text-xs text-gray-11">
                  Community Action for Sustainable Development
                </span>
              </div>
            </div>
            <Image
              src={laira_sitting}
              width={92}
              alt="Laira sitting"
              className="absolute bottom-full right-6 translate-y-2 max-md:hidden"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
