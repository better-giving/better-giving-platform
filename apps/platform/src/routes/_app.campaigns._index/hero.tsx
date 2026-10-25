import { Image } from "@better-giving/ui";
import hero from "./hero.webp";

export default function Hero({ classes = "" }: { classes?: string }) {
  return (
    <div
      className={`${classes} grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 justify-items-center lg:content-start`}
    >
      <div className="self-center">
        <p className="max-lg:text-center uppercase mb-2 font-bold ">
          Raise Funds. Fuel Impact
        </p>
        <h1 className="mb-4 capitalize text-center text-2xl lg:text-4xl text-pretty lg:text-left">
          Fundraising, The&nbsp;Better&nbsp;Giving Way
        </h1>

        <p className="text-xl lg:text-2xl max-lg:text-center text-balance ">
          Campaigns that support one or several nonprofits. Every donation goes
          where you want it to.
        </p>
      </div>

      <Image width={600} src={hero} className="rounded" />
    </div>
  );
}
