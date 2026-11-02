import { StepsCarousel } from "#/components/donation";

export function DonationFormInfo({ classes = "" }) {
  return (
    <section className={`${classes} grid content-start py-20`}>
      <h1 className="col-span-full text-center hero-heading mb-4">
        Raise more. Save more. Do less.
      </h1>
      <p className="col-span-full mb-4 text-center text-xl max-w-2xl mx-auto text-pretty">
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
