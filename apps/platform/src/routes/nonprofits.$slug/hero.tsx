import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import { BOOK_A_DEMO } from "#/constants/urls";
import type { PageContext } from "./types";

interface Props extends PageContext {
  classes?: string;
}
export function Hero({ classes = "", ...props }: Props) {
  return (
    <section
      className={`${classes} grid justify-items-center gap-10 xl:justify-items-start xl:grid-cols-2 pb-24 pt-20`}
    >
      <div className="max-w-2xl order-2 xl:order-1">
        <h1 className="text-center xl:text-left section-heading mb-4">
          Raise more this quarter.{" "}
          <span className="text-primary">Grow funds together.</span>
        </h1>
        <p className="my-10 text-lg xl:text-xl text-balance text-center xl:text-left">
          No platform fee while the optional donor contribution stays on (1.5%
          if you turn it off). A high-converting donation flow helps your{" "}
          {props.hero_subject[2]} bring in more gifts today and build lasting
          capacity over time.
        </p>

        <div className="flex flex-col xl:flex-row justify-center xl:justify-start items-center gap-6">
          <Link
            to={href("/register")}
            className="text-center btn xl:btn-lg btn-primary font-bold"
          >
            Start Free
          </Link>
          <Link
            to={BOOK_A_DEMO}
            className="capitalize text-center btn xl:btn-lg btn-secondary font-bold"
          >
            See how it works (&nbsp;Book&nbsp;a&nbsp;call&nbsp;)
          </Link>
        </div>
      </div>
      <Image
        className="max-w-2xl xl:max-w-auto order-1 xl:order-2 w-full self-center rounded"
        src={props.hero}
      />
    </section>
  );
}
