import { href, Link } from "react-router";
import { app_name } from "#/constants/env";
import { BOOK_A_DEMO } from "#/constants/urls";
import hero_img from "./hero-2-img.png";

export function Hero2({ classes = "" }) {
  return (
    <section
      className={`${classes} grid content-start justify-items-center gap-10 xl:justify-items-start xl:grid-cols-2 py-28`}
    >
      <div className="max-w-2xl order-2 xl:order-1">
        <h1 className="text-center xl:text-left mb-4 section-heading">
          Why stop at one day of generosity?
        </h1>
        <p className="mb-10 text-lg xl:text-xl text-center xl:text-left">
          Every year, Giving Tuesday brings a surge of generosity and a flood of
          "limited-time offers." But those features often vanish the next day.
        </p>
        <p className="mb-10 text-lg xl:text-xl text-center xl:text-left text-primary font-semibold">
          At {app_name}, generosity doesn't expire. Every donation works harder,
          every day of the year.
        </p>

        <div className="flex flex-col xl:flex-row justify-center xl:justify-start items-center gap-6">
          <Link
            to={href("/register")}
            className="btn xl:btn-lg btn-primary font-bold"
          >
            Join us today!
          </Link>
          <Link
            to={BOOK_A_DEMO}
            className="btn xl:btn-lg btn-secondary font-bold"
          >
            Learn how it works
          </Link>
        </div>
      </div>
      <img
        width={450}
        alt="laira floating and holding a wrapped gift"
        src={hero_img}
        className="max-xl:w-64 order-1 xl:order-2 xl:justify-self-end self-center"
      />
    </section>
  );
}
