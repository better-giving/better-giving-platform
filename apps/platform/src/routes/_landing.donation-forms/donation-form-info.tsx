import { StepsCarousel } from "#/components/donation";

export function DonationFormInfo({ classes = "" }) {
  return (
    <section className={`${classes} grid content-start py-20`}>
      <p className="mb-4 col-span-full text-primary pre-heading text-center">
        Your all-in-one donation form
      </p>
      <h2 className="col-span-full text-center hero-heading mb-4">
        Raise more. Save more. Do less.
      </h2>
      <p className="col-span-full mb-4 text-center text-xl text-navy">
        No setup costs and no recurring charges. No platform fee while the
        optional donor contribution stays on. Turning that ask off is a 1.5%
        fee.
      </p>

      <StepsCarousel
        classes="w-full max-w-lg self-center justify-self-center"
        dot_position="bottom"
        hand_position="right"
      />
    </section>
  );
}
