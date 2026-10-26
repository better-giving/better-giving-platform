import type { ReactNode } from "react";
import { href, Link } from "react-router";

const get_link = (slug: string, base_url: string) =>
  `${base_url}${href("/campaigns/:fund_id", { fund_id: slug })}`;

interface Props {
  slug_init?: string;
  slug_new: string;
  slug_field: ReactNode;
  base_url: string;
}
export function Slug({
  slug_init = "",
  slug_new,
  slug_field,
  base_url,
}: Props) {
  const link = slug_init && get_link(slug_init, base_url);

  return (
    <div>
      {slug_field}
      {link && (
        <div className="text-sm italic mt-1">
          <span>Current link:</span>{" "}
          <Link to={link} className="link">
            {link}
          </Link>
        </div>
      )}
      <p className="text-xs sm:text-sm text-gray-11 italic mt-2">
        Swap the ID at the end of your campaign's link for a name donors will
        recognize. Letters, numbers, and - . _ ~ only: not all numbers, and no
        dot at the start, at the end, or twice in a row. The ID link keeps
        working.
      </p>

      <p className="text-xs sm:text-sm text-gray-11 italic mt-2">
        Example: {get_link(slug_new || "my-campaign", base_url)}
      </p>
    </div>
  );
}
