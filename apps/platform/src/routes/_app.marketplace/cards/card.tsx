import { Image } from "@better-giving/ui";
import { href, NavLink } from "react-router";
import flying_character from "#/assets/images/flying-character.webp";
import { BookmarkBtn } from "#/components/bookmark-btn";
import { ShareButton } from "#/components/share-btn";
import { base_url } from "#/constants/env";
import type { EndowmentCard } from "#/types/npo";

const PLACEHOLDER_TAGLINE = " ";

export function Card({
  name,
  logo,
  image,
  card_img,
  id,
  tagline,
}: EndowmentCard) {
  const banner = image || card_img;
  return (
    <div className="relative has-[.pending]:grayscale has-[.pending]:pointer-events-none grid grid-rows-subgrid row-span-3 gap-y-0">
      <NavLink
        to={href("/org/:org", { org: id.toString() })}
        className="grid grid-rows-subgrid row-span-3 h-full overflow-clip bg-card rounded-card shadow-card transition-colors hover:bg-panel"
      >
        <div data-banner className="aspect-4/1 w-full relative bg-secondary">
          {/* no banner is a plain fill: `Image` without a src paints a placeholder glyph */}
          {banner && (
            <Image
              loading="lazy"
              src={banner}
              className="w-full h-full object-cover"
              onError={(e) => e.currentTarget.classList.add("invisible")}
            />
          )}
          <Image
            width={60}
            height={60}
            loading="lazy"
            src={logo || flying_character}
            className="absolute bottom-0 translate-y-1/2 z-10 left-3 size-15 object-cover rounded-full border-2 border-primary bg-panel shadow-lift-media"
            onError={(e) => e.currentTarget.classList.add("bg-secondary")}
          />
        </div>

        <div className="grid grid-rows-subgrid row-span-2 p-3 pb-16 gap-3">
          <h3 className="text-ellipsis line-clamp-2 mt-8 -mb-2">
            <span className="inline">{name}</span>
          </h3>

          {tagline && tagline !== PLACEHOLDER_TAGLINE ? (
            <p className="text-gray-11 text-sm line-clamp-3 mb-4">{tagline}</p>
          ) : (
            <div />
          )}
        </div>
      </NavLink>
      {/** absolute so above whole `Link` card */}
      <div className="absolute grid grid-cols-[1fr_auto_1fr] items-center bottom-4 left-4 right-4">
        <ShareButton
          orgName={name}
          url={`${base_url}${href("/org/:org", { org: id.toString() })}`}
          classes="justify-self-start grid place-items-center size-9"
        />
        <NavLink
          to={href("/donate/:id", { id: id.toString() })}
          className="btn btn-primary"
        >
          Donate
        </NavLink>
        <BookmarkBtn
          npo={{ name, id, logo: logo || card_img || undefined }}
          classes="justify-self-end size-9"
        />
      </div>
    </div>
  );
}
