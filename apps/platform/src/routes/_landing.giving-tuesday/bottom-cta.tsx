import { href, Link } from "react-router";
import { app_name } from "#/constants/env";

export function BottomCta({ classes = "" }) {
  return (
    <div
      className={`${classes} surface-primary rounded md:rounded px-10 py-12 md:px-16 lg:px-20 lg:py-16`}
    >
      <h2 className="text-center text-4xl md:text-5xl lg:text-5xl text-primary-fg mb-6 leading-tight">
        Join nonprofits who keep the Giving Tuesday spirit alive, all year.
      </h2>
      <p className="text-center text-lg md:text-xl text-primary-fg mb-10 max-w-4xl mx-auto">
        {app_name} is free for 501(c)(3)s. Start earning, saving, and growing
        donor trust today.
      </p>
      <div className="flex flex-col md:flex-row justify-center items-center gap-6 mb-12">
        <Link
          to={href("/register")}
          className="btn btn-lg btn-inverse font-bold"
        >
          Join us today!
        </Link>
        <Link
          to={href("/product")}
          className="btn btn-lg btn-outline font-bold"
        >
          Learn How It Works
        </Link>
      </div>
      <div className="rounded p-8 max-w-4xl mx-auto">
        <p className="text-lg md:text-xl italic text-primary-fg mb-4 text-center">
          "{app_name} helped us keep donations flowing long after Giving Tuesday
          ended, and the yields didn't stop either."
        </p>
        <p className="text-primary-fg text-center">
          - Sarah Chen, Executive Director
        </p>
      </div>
    </div>
  );
}
