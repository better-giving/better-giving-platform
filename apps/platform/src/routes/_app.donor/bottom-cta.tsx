import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_waiving from "#/assets/laira/laira-waiving.webp";

export function BottomCta({ classes = "" }) {
  return (
    <div
      className={`${classes} grid @5xl:grid-cols-2 surface-primary rounded @5xl:rounded ring-8 @md:ring-[1rem] ring-blue-6 px-10 py-12 @5xl:px-16 @5xl:py-20`}
    >
      <div className="grid order-2 @5xl:order-1">
        <h4 className="text-center @5xl:text-left @md:text-lg leading-normal mb-6">
          Simple. Sustainable. Free.
        </h4>
        <h3 className="text-center @5xl:text-left @5xl:leading-snug  text-2xl @sm:text-4xl mb-9">
          Together, we can change the world for good
        </h3>
        <Link
          to={href("/marketplace")}
          className="btn btn-inverse btn-lg justify-self-center @5xl:justify-self-start"
        >
          Donate today
        </Link>
      </div>
      <Image
        src={laira_waiving}
        className="place-self-center mb-8 order-1 @5xl:order-2"
      />
    </div>
  );
}
