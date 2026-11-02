import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import { benefits } from "#/content/benefits";

export function Hero({ classes = "" }) {
  return (
    <section
      className={`${classes} grid justify-items-center gap-y-10 @6xl:justify-items-start @6xl:grid-cols-[3fr_2fr] py-24`}
    >
      <div className="grid content-start max-w-2xl order-2 @6xl:order-1">
        <h4 className="text-center @6xl:text-left @6xl:text-lg mb-5">
          Give today, give forever
        </h4>
        <h1 className="text-center @6xl:text-left text-4xl @6xl:text-5xl @6xl:leading-tight text-pretty mb-4">
          Making a lasting impact has never been so simple
        </h1>
        <p className="mb-10 text-lg @6xl:text-xl text-center @6xl:text-left">
          Easily support grassroots organizations all over the world with card,
          crypto, stock, and DAF gifts that keep on giving. As a nonprofit, we
          charge no platform fee while a nonprofit leaves the optional
          contribution on. Turning that ask off is a 1.5% fee.
        </p>

        <Link
          to={href("/marketplace")}
          className="justify-self-center @6xl:justify-self-start btn btn-lg btn-primary"
        >
          Donate today
        </Link>
      </div>

      <Image
        src={benefits.nonprofits[1].img}
        width={350}
        height={350}
        className="order-1 @6xl:order-2 justify-self-center"
      />
    </section>
  );
}
