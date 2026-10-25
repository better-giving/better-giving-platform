import { Image } from "@better-giving/ui";
import { href, NavLink } from "react-router";
import flying_character from "#/assets/images/flying-character.webp";
import { BookmarkBtn } from "#/components/bookmark-btn";
import { ShareButton } from "#/components/share-btn";
import { base_url } from "#/constants/env";
import type { EndowmentCard } from "#/types/npo";

const PLACEHOLDER_TAGLINE = " ";

export function Card({ name, card_img, id, tagline }: EndowmentCard) {
  return (
    <div className="relative bg-panel border rounded has-[.pending]:grayscale has-[.pending]:pointer-events-none  grid grid-rows-subgrid row-span-3 gap-y-0">
      <NavLink
        to={href("/org/:org", { org: id.toString() })}
        className="grid grid-rows-subgrid row-span-3 h-full overflow-clip"
      >
        <Image
          loading="lazy"
          src={card_img || flying_character}
          className="h-40 w-full object-cover bg-secondary"
          onError={(e) => e.currentTarget.classList.add("bg-secondary")}
        />
        <div className="grid grid-rows-subgrid row-start-2 row-span-2 p-3 pb-16 gap-3">
          {/* nonprofit name */}
          <h3 className="text-ellipsis line-clamp-2 text-center mb-2">
            <span className="inline">{name}</span>
          </h3>

          {/* tagline */}
          {tagline && tagline !== PLACEHOLDER_TAGLINE ? (
            <p className="peer text-gray-11 text-sm -mt-2 mb-4">{tagline}</p>
          ) : (
            <div />
          )}
        </div>
      </NavLink>
      {/** absolute so above whole `Link` card */}
      <div className="absolute grid grid-cols-[1fr_auto_1fr] items-center mt-2 bottom-4 left-4 right-4">
        <ShareButton
          orgName={name}
          url={`${base_url}${href("/org/:org", { org: id.toString() })}`}
          classes=""
        />
        <NavLink
          to={href("/donate/:id", {
            id: id.toString(),
          })}
          className="btn btn-primary"
        >
          Donate
        </NavLink>
        <BookmarkBtn
          npo={{ name, id, logo: card_img ?? undefined }}
          classes="justify-self-end"
        />
      </div>
    </div>
  );
}
