import { to_usd } from "@better-giving/ui/helpers";
import type {
  IDonorMessage,
  IGiveItem,
  IProgramItem,
  IVideoItem,
} from "#/components/org-page/items";
import type { IOrgLayout } from "#/components/org-page/layouts/types";
import { to_text } from "#/components/rich-text/helpers";
import type { INpoPublic } from "$/pg/queries/npo";
import { BANNER, header_donate } from "./layout-dom";

/** the clock the cards count end dates from */
export const NOW = Date.parse("2026-10-01T12:00:00Z");

/** the registration every fixture page carries unless it says otherwise */
export const EIN = "12-3456789";

/** paragraphs as stored portable text */
export const story = (...paras: string[]) =>
  JSON.stringify(
    paras.map((text, i) => ({
      _type: "block",
      _key: `b${i}`,
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: `s${i}`, text, marks: [] }],
    }))
  );

/** wholly inside the viewport, with a box of its own */
export function in_view(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.top >= 0 &&
    r.left >= 0 &&
    r.bottom <= window.innerHeight &&
    r.right <= window.innerWidth
  );
}

/** the header's Donate is shown and wholly in the viewport; throws, naming
 * the cause, when the header shows none, so a poll over it reports that and
 * not a TypeError from `in_view(undefined)` */
export function header_donate_in_view(root: Element): boolean {
  const donate = header_donate(root);
  if (!donate) throw new Error("the header shows no Donate link");
  return in_view(donate);
}

/** room the first screen keeps under Donate, so a wrap the fixture didn't
 * foresee (another face, a longer word) still leaves it in view */
export const FOLD_SLACK = 80;

/** in view, with at least FOLD_SLACK px of the screen left under it */
export function above_fold(el: Element): boolean {
  return (
    in_view(el) &&
    el.getBoundingClientRect().bottom <= window.innerHeight - FOLD_SLACK
  );
}

/** the longest name and tagline the editor takes in practice: ~70 characters,
 * and the tagline at its 140-character limit (lib/npo/schema.ts) */
export const LONG_NAME =
  "The Riverside Community Adult Literacy and Family Learning Partnership";
export const TAGLINE_MAX =
  "Free one-to-one reading tutoring for adults across three counties, so every grown-up can read a bus timetable, a medicine label and a story.";

const PROSE =
  "Riverside Literacy puts a trained reading tutor beside every adult learner who asks for one, twice a week, in libraries and church halls across three counties. ";

/** one paragraph of exactly `chars` characters */
export const prose = (chars: number) =>
  PROSE.repeat(Math.ceil(chars / PROSE.length)).slice(0, chars);

export const give = (n: number): IGiveItem => ({
  kind: "campaign",
  id: `give-${n}`,
  title: `Clean water ${n}`,
  to: `/campaigns/${n}`,
  image: null,
  raised: 2400,
  goal: 7900,
  ends_at: null,
  byline: null,
  excerpt: "Wells for three villages before the dry season.",
});

export const supporter_fund = (n: number): IGiveItem => ({
  ...give(n),
  kind: "supporter",
  id: `supporter-${n}`,
  title: `Read-a-thon ${n}`,
  to: `/campaigns/${n}`,
  byline: "by Jane",
});

export const program = (n: number): IProgramItem => ({
  kind: "program",
  id: `program-${n}`,
  title: `School meals ${n}`,
  to: `/programs/${n}`,
  image: null,
  summary: "A hot lunch for every pupil, every school day.",
  goal: null,
  raised: 0,
});

export const video = (n: number): IVideoItem => ({
  kind: "video",
  id: `video-${n}`,
  url: `https://www.youtube.com/watch?v=dQw4w9WgXc${n}`,
  title: `Field visit ${n}`,
});

export const message = (n: number): IDonorMessage => ({
  id: `message-${n}`,
  name: `Donor ${n}`,
  message: `Keep up the good work, from donor ${n}.`,
});

/** `n` of an item, numbered from 1 */
export const many = <T>(make: (n: number) => T, n: number): T[] =>
  Array.from({ length: n }, (_, i) => make(i + 1));

/** a published org with a banner, no logo and a one-line story */
export const npo = (o: Partial<INpoPublic> = {}): INpoPublic => ({
  id: 7,
  slug: "riverside-literacy",
  keyword: null,
  registration_number: EIN,
  name: "Riverside Literacy",
  endow_designation: "Charity",
  overview_v2: null,
  overview_pt: story("We teach adults to read."),
  tagline: "Every adult a reader.",
  image: BANNER,
  logo: null,
  card_img: null,
  hq_country: "United States",
  active_in_countries: [],
  social_media_urls: null,
  url: "https://riverside.example.org",
  sdgs: [],
  receipt_msg: null,
  hide_bg_tip: false,
  published: true,
  active: true,
  prog_donations_allowed: true,
  donate_methods: null,
  donate_frequencies: [],
  increments: null,
  fund_opt_in: false,
  kyc_donors_only: false,
  fiscal_sponsored: false,
  street_address: null,
  donor_address_required: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  target: undefined,
  contributions_total: 3322,
  contributions_count: 49,
  ...o,
});

/** the org-wide figures a page shows, each as the text or role that gave it
 * away: the raised total, a donor count, a goal bar or goal line, the
 * first-gift ask. `toEqual([])` prints whichever is back. `org_figures.test`
 * renders each shape this reads, so a pattern that stops matching goes red
 * there rather than letting a page that shows the figure pass */
export function org_figures(root: Element, org: INpoPublic): string[] {
  const text = root.textContent ?? "";
  const found = Array.from(
    root.querySelectorAll("[role=progressbar], [role=meter], progress, meter")
  ).map((bar) => `progressbar ${bar.getAttribute("aria-label") ?? ""}`.trim());
  // a bar drawn as a sized div carries no role, only its percent width
  if (root.querySelector("[style*='width'][style*='%']")) found.push("bar");
  const total = org.contributions_total;
  // a $0 total prints as "0" in too much unrelated text to search for
  const spellings = [to_usd(total)];
  if (total >= 1000) {
    spellings.push(
      total.toLocaleString("en-US"),
      `${(total / 1000).toFixed(1)}K`
    );
  }
  const spelled = spellings.find((spelling) => text.includes(spelling));
  if (spelled) found.push(spelled);
  for (const re of [
    /\b(raised|given|funded|donated)\b/i,
    /[\d,]+\s*(donors?|supporters?|givers?|backers?)\b/i,
    /\bgoal\b/i,
    /be the first to give/i,
  ]) {
    const m = text.match(re);
    if (m) found.push(m[0]);
  }
  return found;
}

/** a page's props. the shape is measured from the npo and the lists given,
 * as the loader measures it, unless `shape` says otherwise */
export function org_layout(o: Partial<IOrgLayout> = {}): IOrgLayout {
  const p: IOrgLayout = {
    npo: npo(),
    shape: {
      story_chars: 0,
      tagline_chars: 0,
      name_chars: 0,
      has_banner: false,
      has_logo: false,
      campaigns: 0,
      supporters: 0,
      programs: 0,
      videos: 0,
    },
    donate_to: "/donate/7",
    share: { recipientName: "Riverside Literacy", url: "https://x/org/7" },
    now: NOW,
    give: [],
    programs: [],
    videos: [],
    failed: { give: false, programs: false, videos: false },
    messages: [],
    footer: {},
    credential: { label: "EIN", value: EIN },
    ...o,
  };
  return {
    ...p,
    shape: {
      story_chars: to_text(p.npo.overview_pt).trim().length,
      tagline_chars: p.npo.tagline?.trim().length ?? 0,
      name_chars: p.npo.name.trim().length,
      has_banner: !!p.npo.image,
      has_logo: !!p.npo.logo,
      campaigns: p.give.filter((x) => x.kind === "campaign").length,
      supporters: p.give.filter((x) => x.kind === "supporter").length,
      programs: p.programs.length,
      videos: p.videos.length,
      ...o.shape,
    },
  };
}
