import { Image } from "@better-giving/ui";
import hero from "./hero.webp";

export function Hero({ classes = "" }: { classes?: string }) {
  return (
    <div
      className={`${classes} grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 justify-items-center lg:content-start`}
    >
      <div className="self-center">
        <h1 className="mb-4 text-center text-2xl lg:text-4xl text-balance lg:text-left">
          Giving made smarter. Impact made stronger.
        </h1>

        <p className="text-xl lg:text-2xl max-lg:text-center text-balance">
          Find and support charities, nonprofits, universities, and faith-based
          organizations—all in one place.
        </p>
      </div>

      <Image width={500} src={hero} className="rounded" />
    </div>
  );
}
