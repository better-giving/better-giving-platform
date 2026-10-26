import { Image, Target, to_target } from "@better-giving/ui";
import { href, NavLink } from "react-router";
import flying_character from "#/assets/images/flying-character.webp";
import { to_text } from "#/components/rich-text";
import { ShareButton } from "#/components/share-btn";
import { base_url } from "#/constants/env";
import type { IFundItem } from "@/campaign";

export function Card({
  name,
  logo,
  banner,
  id,
  description_pt,
  donation_total_usd,
  target,
}: IFundItem) {
  return (
    <div className="relative has-[.pending]:grayscale has-[.pending]:pointer-events-none grid grid-rows-subgrid row-span-4">
      <NavLink
        to={href("/fundraisers/:fund_id", { fund_id: id })}
        className="grid grid-rows-subgrid row-span-4 h-full overflow-clip rounded border hover:border-primary"
      >
        <div className="aspect-4/1 w-full relative">
          <Image
            loading="lazy"
            src={banner}
            className="w-full h-full object-cover bg-secondary"
            onError={(e) => e.currentTarget.classList.add("bg-secondary")}
          />
          <Image
            width={60}
            height={60}
            loading="lazy"
            src={logo || flying_character}
            className="absolute bottom-0 translate-y-1/2 z-10 left-3 rounded-full border-2 border-primary shadow-lift-media"
            onError={(e) => e.currentTarget.classList.add("bg-secondary")}
          />
        </div>

        <div className="grid grid-rows-subgrid row-span-3 p-3 pb-16 gap-3">
          {/* nonprofit name */}
          <h3 className="text-ellipsis line-clamp-2 mt-4 -mb-2">
            <span className="inline">{name}</span>
          </h3>

          <p className="peer text-sm line-clamp-3 mb-4">
            {to_text(description_pt)}
          </p>

          <Target target={to_target(target)} progress={donation_total_usd} />
        </div>
      </NavLink>
      {/** absolute so above whole `Link` card */}
      <div className="absolute items-center grid grid-cols-[1fr_auto_1fr] mt-2 bottom-4 left-4 right-4">
        <ShareButton
          classes="justify-self-start"
          orgName={name}
          url={`${base_url}${href("/fundraisers/:fund_id", { fund_id: id })}`}
        />
        <NavLink
          to={href("/donate-fund/:fund_id", { fund_id: id })}
          className="btn btn-primary"
        >
          Donate
        </NavLink>
        <div /> {/** future: like button  */}
      </div>
    </div>
  );
}
