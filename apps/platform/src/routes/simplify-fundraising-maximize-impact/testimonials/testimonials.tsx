import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import quotation from "#/assets/icons/quotation.svg";
import { testimonials } from "#/content/testimonials";
import { use_drag_scroll } from "#/hooks/use-drag-scroll";
import TestimonialCard from "./testimonial-card";

function scroll_carousel(container: HTMLDivElement, direction: -1 | 1) {
  const child = container.firstElementChild;
  if (!child) return;
  const slide_width = child.getBoundingClientRect().width;
  const at_start = container.scrollLeft <= 2;
  const at_end =
    container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;

  if (direction === -1 && at_start) {
    container.scrollTo({ left: container.scrollWidth, behavior: "smooth" });
  } else if (direction === 1 && at_end) {
    container.scrollTo({ left: 0, behavior: "smooth" });
  } else {
    container.scrollBy({ left: direction * slide_width, behavior: "smooth" });
  }
}

const Testimonials = ({ classes = "" }) => {
  const ref = useRef<HTMLDivElement>(null);
  use_drag_scroll(ref);

  return (
    <div className={`grid relative pt-48 ${classes}`}>
      <img
        src={quotation}
        alt="quotation mark"
        className="justify-self-center w-24 lg:w-36 mb-8"
      />
      <h3 className="px-5 text-center text-3xl/tight md:text-4.5xl/tight text-pretty justify-self-center mb-14">
        Nonprofit Success Stories: <br /> Inspiring Change Together
      </h3>

      <div className="relative">
        <div
          ref={ref}
          className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth scrollbar-none cursor-grab"
        >
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="flex-[0_0_100%] sm:flex-[0_0_100%] md:flex-[0_0_50%] lg:flex-[0_0_33.333%] px-2.5 snap-center"
            >
              <TestimonialCard {...testimonial} />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => ref.current && scroll_carousel(ref.current, -1)}
          className="p-4 bg-gray-3 hover:bg-gray-4 active:bg-gray-5 border border-gray-7 hover:border-gray-8 text-primary rounded-full z-10 absolute top-1/2 -translate-y-1/2 left-0 md:-left-5"
          aria-label="Previous slide"
        >
          <ChevronLeft className="icon-2xl" />
        </button>
        <button
          type="button"
          onClick={() => ref.current && scroll_carousel(ref.current, 1)}
          className="p-4 bg-gray-3 hover:bg-gray-4 active:bg-gray-5 border border-gray-7 hover:border-gray-8 text-primary rounded-full z-10 absolute top-1/2 -translate-y-1/2 right-0 md:-right-5"
          aria-label="Next slide"
        >
          <ChevronRight className="icon-2xl" />
        </button>
      </div>
    </div>
  );
};

export default Testimonials;
