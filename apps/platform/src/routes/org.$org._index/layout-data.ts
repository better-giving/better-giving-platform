import { href } from "react-router";
import type { IOrgDetails } from "#/components/org-page/footer";
import type {
  IGiveItem,
  IProgramItem,
  IVideoItem,
} from "#/components/org-page/items";
import type { IOrgLayout } from "#/components/org-page/layouts/types";
import { to_excerpt } from "#/components/rich-text/helpers";
import { extract_youtube_id } from "#/components/youtube-player";
import { program_href } from "#/helpers/org-href";
import { goal_amount } from "#/routes/org.$org.$campaign/format";
import type { IFundItem } from "@/campaign";
import { fund_closes_at, fund_item_is_open } from "@/campaign/is-open";
import { MAX_EXPIRATION_ISO } from "@/campaign/schema";
import type { IMedia, IProgramDb } from "@/npo";
import type { IOrgShape } from "@/org-shape";

/** the list read's `expiration` for a fund that never closes */
const NO_EXPIRY_UNIX = Math.floor(Date.parse(MAX_EXPIRATION_ISO) / 1000);

/** what the loader sends of a live campaign that the give list reads */
interface ICampaignIn {
  id: string;
  name: string;
  to: string;
  /** the campaign's own banner, without the org's in its place */
  banner: string | null;
  raised: number;
  target?: string;
  /** the owner's name, on a campaign this org joined but doesn't run */
  with_org: string | null;
  ends_at: string | null;
  excerpt: string;
}

export function campaign_give(c: ICampaignIn): IGiveItem {
  return {
    kind: "campaign",
    id: c.id,
    title: c.name,
    to: c.to,
    image: c.banner,
    raised: c.raised,
    goal: goal_amount(c.target, c.raised),
    ends_at: c.ends_at,
    byline: c.with_org ? `with ${c.with_org}` : null,
    excerpt: c.excerpt,
  };
}

/** an open fund; one the org owns is its own, so it carries no byline */
export function fund_give(f: IFundItem, npo_id: number): IGiveItem {
  return {
    kind: "supporter",
    id: f.id,
    title: f.name,
    to: href("/campaigns/:fund_id", { fund_id: f.id }),
    image: f.banner || f.logo || null,
    raised: f.donation_total_usd,
    goal: goal_amount(f.target, f.donation_total_usd),
    ends_at:
      f.expiration >= NO_EXPIRY_UNIX
        ? null
        : fund_closes_at(
            new Date(f.expiration * 1000).toISOString()
          ).toISOString(),
    byline: f.npo_owner === npo_id ? null : `by ${f.creator_name}`,
    excerpt: to_excerpt(f.description_pt),
  };
}

interface IRegistration {
  registration_number: string | null;
  hq_country: string | null;
}

export function org_credential({
  registration_number,
  hq_country,
}: IRegistration): IOrgLayout["credential"] {
  const value = registration_number?.trim();
  if (!value) return null;
  const label = hq_country === "United States" ? "EIN" : "Registration no.";
  return { label, value };
}

interface ILayoutListsIn {
  npo: { id: number; slug?: string | null };
  campaigns: ICampaignIn[];
  funds: PromiseSettledResult<IFundItem[]>;
  programs: PromiseSettledResult<IProgramDb[]>;
  media: PromiseSettledResult<IMedia[]>;
  now: Date;
}

/** the layout's lists from the loader's settled reads; a read that failed
 * leaves its items out and its list flagged, for its section's failure line */
export function layout_lists({
  npo,
  campaigns,
  funds,
  programs,
  media,
  now,
}: ILayoutListsIn): Pick<
  IOrgLayout,
  "give" | "programs" | "videos" | "failed"
> {
  const read = <T>(r: PromiseSettledResult<T[]>) =>
    r.status === "fulfilled" ? r.value : [];
  return {
    // campaigns are their own read: a failed fund read flags the list but keeps them
    give: [
      ...campaigns.map(campaign_give),
      ...read(funds)
        .filter((f) => fund_item_is_open(f, now))
        .map((f) => fund_give(f, npo.id)),
    ],
    programs: read(programs).map(
      (p): IProgramItem => ({
        kind: "program",
        id: p.id,
        title: p.title,
        to: program_href(npo, p.id),
        image: p.banner ?? null,
        summary: to_excerpt(p.description_pt),
        goal: p.target_raise ?? null,
        raised: p.total_donations ?? 0,
      })
    ),
    videos: read(media)
      .filter((m) => extract_youtube_id(m.url))
      .map(
        (m): IVideoItem => ({
          kind: "video",
          id: m.id,
          url: m.url,
          title: null,
        })
      ),
    failed: {
      give: funds.status === "rejected",
      programs: programs.status === "rejected",
      videos: media.status === "rejected",
    },
  };
}

type TLists = Pick<IOrgLayout, "give" | "programs" | "videos">;

/** the shape's item counts, read off the lists so a layout is never picked for
 * an item that doesn't render */
export const shape_counts = ({
  give,
  programs,
  videos,
}: TLists): Pick<
  IOrgShape,
  "campaigns" | "supporters" | "programs" | "videos"
> => ({
  campaigns: give.filter((g) => g.kind === "campaign").length,
  supporters: give.filter((g) => g.kind !== "campaign").length,
  programs: programs.length,
  videos: videos.length,
});

interface IFooterIn {
  registration_number: string | null;
  street_address?: string | null;
  active_in_countries: string[];
  hq_country: string | null;
}

/** the footer's details: where the org works, else where it is based */
export const org_details = (npo: IFooterIn): IOrgDetails => ({
  registration_number: npo.registration_number,
  address: npo.street_address,
  active_in:
    npo.active_in_countries.length > 0
      ? npo.active_in_countries.join(", ")
      : npo.hq_country,
});
