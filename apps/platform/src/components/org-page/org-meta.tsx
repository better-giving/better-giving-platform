import { Badge, ExtLink } from "@better-giving/ui";
import {
  BadgeCheck,
  Globe,
  Heart,
  type LucideIcon,
  MapPin,
} from "lucide-react";
import type { ReactNode } from "react";
import { website_link } from "#/routes/org.$org.$campaign/format";
import type { INpoPublic } from "$/pg/queries/npo";
import { is_brand_ground, use_ground } from "./brand-band";
import type { IOrgLayout } from "./layouts/types";

type TMetaNpo = Pick<INpoPublic, "endow_designation" | "hq_country" | "url">;

interface IOrgMeta {
  npo: TMetaNpo;
  /** the org's registration; null when unknown, and then left out */
  credential: IOrgLayout["credential"];
  classes?: string;
}

/** the org's facts, each in its own place: the designation as a badge, then
 * the country, the website named by its host, and the registration, each
 * behind its glyph, the badge's in its own ink. "Other" is no designation and is left out, as is any
 * fact that is missing */
export function OrgMeta({ npo, credential, classes = "" }: IOrgMeta) {
  const brand = is_brand_ground(use_ground());
  const website = website_link(npo.url);
  if (
    npo.endow_designation === "Other" &&
    !npo.hq_country &&
    !website &&
    !credential
  ) {
    return null;
  }

  return (
    <ul
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${brand ? "" : "text-gray-11"} ${classes}`}
    >
      {npo.endow_designation !== "Other" && (
        <li className="flex">
          {/* secondary on every ground, the deep fill included: an opaque
              surface + ink pair, legible whatever is under it */}
          <Badge tone="secondary">
            <Heart aria-hidden className="icon-xs mr-1" />
            {npo.endow_designation}
          </Badge>
        </li>
      )}
      {npo.hq_country && <Fact icon={MapPin}>{npo.hq_country}</Fact>}
      {website && (
        <Fact icon={Globe}>
          <ExtLink
            href={website.href}
            // on a brand fill the ink is the band's and there is no hover rung
            className={`underline underline-offset-4 ${brand ? "" : "link"}`}
          >
            {website.label}
          </ExtLink>
        </Fact>
      )}
      {credential && (
        <Fact icon={BadgeCheck}>
          {credential.label} <span className="figures">{credential.value}</span>
        </Fact>
      )}
    </ul>
  );
}

interface IFact {
  icon: LucideIcon;
  children: ReactNode;
}

/** a long country can wrap inside its item; the glyph's box is one line tall
 * so it stays on the first */
function Fact({ icon: Icon, children }: IFact) {
  return (
    <li className="flex min-w-0 items-start gap-1.5">
      <span className="flex h-lh items-center">
        <Icon aria-hidden className="icon-sm" />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
