import { href, Link } from "react-router";
import { app_name } from "#/constants/env";
import { BOOK_A_DEMO } from "#/constants/urls";
import hero_img from "./hero-img.png";

export function Hero({ classes = "" }) {
  return (
    <section
      className={`${classes} grid content-start justify-items-center gap-10 xl:justify-items-start xl:grid-cols-2 pt-20 xl:pt-40  pb-24`}
    >
      <div className="max-w-2xl order-2 xl:order-1">
        <p className="pre-heading text-primary text-center xl:text-left mb-5">
          Giving Tuesday is one day.
        </p>
        <h1 className="text-center xl:text-left mb-4 hero-heading">
          {app_name} <br /> Lasts All Year.
        </h1>
        <p className="mb-10 text-lg xl:text-xl text-center xl:text-left">
          Other platforms turn on special features for one day. At {app_name},
          they're always on — for free.
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
            className="btn xl:btn-lg btn-secondary font-bold border-2"
          >
            Learn how it works
          </Link>
        </div>
      </div>
      <img
        width={320}
        alt="laira floating and holding a wrapped gift"
        src={hero_img}
        className="max-xl:w-64 order-1 xl:order-2 xl:justify-self-end self-center"
      />
    </section>
  );
}
