import { Image } from "@better-giving/ui";
import type { Testimonial } from "#/content/testimonials";

const TestimonialCard = (props: Testimonial) => {
  return (
    <div className="@container">
      <Image
        height={240}
        src={props.org_logo.src}
        alt="Reviewer's organization logo"
        className="object-contain size-28 rounded ml-8 bg-panel shadow-lift-media"
      />
      <div className="relative -mt-14 pt-24 px-8 pb-8 rounded-card bg-card shadow-card -z-10">
        <p className="text-lg @md:h-64 mt-8">{props.content}</p>
        <p className="mt-4 @md:mt-0 text-lg opacity-90 font-bold">
          {props.reviewer}
        </p>
        <p className="md:text-lg font-medium">{props.org}</p>
      </div>
    </div>
  );
};

export default TestimonialCard;
