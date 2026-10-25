import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { RichText, to_text } from "#/components/rich-text";
import { STORY_CLAMP } from "@/org-shape";
import { BrandBand } from "../brand-band";
import { first_sentence } from "../first-sentence";
import { GivePanel } from "../give-panel";
import type { IHeaderSection } from "../header";
import { ItemsByCount } from "../items-by-count";
import { OrgMeta } from "../org-meta";
import { OrgName } from "../org-name";
import { QuoteStrip } from "../quote-strip";
import { SECTION_HEADING } from "../section-heading";
import { SectionLink } from "../section-link";
import { SwipeRow } from "../swipe-row";
import { VideoSet } from "../video-set";
import { OrgPageFrame } from "./org-page-frame";
import type { IOrgLayout } from "./types";
import { FailedLine, give_label } from "./ways-to-help";

type TKind = keyof IOrgLayout["failed"];

const KINDS: TKind[] = ["give", "programs", "videos"];

/** each kind's heading, which its header link repeats; give's is named by
 * what the list holds */
const LABEL: Record<Exclude<TKind, "give">, string> = {
  programs: "Programs",
  videos: "Videos",
};

/** the in-page anchor each section takes */
const ANCHOR: Record<TKind | "story", string> = {
  story: "story",
  give: "campaigns",
  programs: "programs",
  videos: "videos",
};

/** clears the sticky header when an anchor lands on a section */
const ANCHORED = "scroll-mt-20";

/** the hero text's column and the give card's, shared by every row the card
 * runs beside so their edges line up */
const COLUMNS =
  "md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:gap-x-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-16";

/** a long story, 4+ items: a tint hero, the story beside a give card that
 * rises into the hero and sticks while the story scrolls, then a section per
 * kind. a phone reads the hero, the card, the section links, then the story */
export function Feature(props: IOrgLayout) {
  const { npo, shape, failed, now } = props;
  const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
  const lists = {
    give: props.give,
    programs: props.programs,
    videos: props.videos,
  };
  const has_story = !!to_text(npo.overview_pt).trim();
  // a failed kind keeps its section, so its line is seen
  const kinds = KINDS.filter((k) => failed[k] || lists[k].length > 0);
  const label = (k: TKind) =>
    k === "give" ? give_label(lists.give) : LABEL[k];
  const sections: IHeaderSection[] = [
    ...(has_story ? [{ id: ANCHOR.story, label: "Story" }] : []),
    ...kinds.map((k) => ({ id: ANCHOR[k], label: label(k) })),
  ];

  /** what loaded, then the line for what didn't */
  function content(k: TKind): ReactNode {
    return (
      <>
        {k === "videos" ? (
          <VideoSet videos={lists.videos} />
        ) : (
          // programs are rows at any count
          <ItemsByCount items={lists[k]} now={now} />
        )}
        {failed[k] && <FailedLine kind={k} />}
      </>
    );
  }

  return (
    <OrgPageFrame page={props} hero_donate={hero_donate} sections={sections}>
      {/* from md the card's rail overlays the hero, the strip and the story
          as one cell, so the card sticks for all three; its 1fr row grows
          when the card outruns the story */}
      <div className="flex flex-col md:grid md:grid-rows-[auto_auto_1fr]">
        <FeatureHero page={props} />
        <div
          className={`page max-md:border-b max-md:bg-band max-md:pb-8 md:pointer-events-none md:col-start-1 md:row-span-full md:row-start-1 md:pt-10 ${COLUMNS}`}
        >
          <GivePanel
            name={npo.name}
            banner={npo.image}
            donate_to={props.donate_to}
            donate_ref={set_hero_donate}
            classes="md:pointer-events-auto md:sticky md:top-20 md:col-start-2 md:self-start"
          />
        </div>
        <SectionStrip sections={sections} />
        {has_story && (
          <div
            className={`page pt-8 md:col-start-1 md:row-start-3 md:pt-12 ${COLUMNS}`}
          >
            <Story
              json={npo.overview_pt}
              clamp={shape.story_chars > STORY_CLAMP}
            />
          </div>
        )}
      </div>
      <div className="page flex flex-col gap-10 py-8 md:gap-12 md:py-12">
        {kinds.map((k) =>
          k === "give" && lists.give.length > 3 ? (
            <div
              key={k}
              id={ANCHOR.give}
              className={`flex flex-col gap-3 ${ANCHORED}`}
            >
              <SwipeRow heading={label(k)} items={lists.give} now={now} />
              {failed.give && <FailedLine kind="give" />}
            </div>
          ) : (
            <Section key={k} id={ANCHOR[k]} heading={label(k)}>
              {content(k)}
            </Section>
          )
        )}
        <QuoteStrip
          messages={props.messages}
          tone="dark"
          on_more={props.on_more_messages}
        />
      </div>
    </OrgPageFrame>
  );
}

interface IFeatureHero {
  page: IOrgLayout;
}

/** the facts, the name and the lead line (the tagline, or the story's first
 * sentence) on the tint, in the text's column */
function FeatureHero({ page }: IFeatureHero) {
  const { npo } = page;
  const lead = npo.tagline?.trim() || first_sentence(to_text(npo.overview_pt));
  return (
    <BrandBand
      tone="tint"
      classes="pt-8 pb-6 md:col-start-1 md:row-start-1 md:border-b md:py-10"
    >
      <div className={`page ${COLUMNS}`}>
        <div className="flex flex-col gap-4">
          <OrgMeta npo={npo} credential={page.credential} />
          <OrgName name={npo.name} scale="md" />
          {lead && (
            <p className="line-clamp-3 max-w-3xl text-lg text-gray-11 md:text-xl">
              {lead}
            </p>
          )}
        </div>
      </div>
    </BrandBand>
  );
}

interface ISectionStrip {
  sections: IHeaderSection[];
}

/** the header's section links, for the widths the header leaves them out */
function SectionStrip({ sections }: ISectionStrip) {
  if (sections.length === 0) return null;
  return (
    <nav
      aria-label="Sections"
      className="border-b md:col-start-1 md:row-start-2 lg:hidden"
    >
      <div className={`page ${COLUMNS}`}>
        {/* the first label's text, not its target, on the page's edge */}
        <ul className="scrollbars -ml-2.5 flex gap-1 overflow-x-auto">
          {sections.map((s) => (
            <li key={s.id} className="shrink-0">
              <SectionLink
                id={s.id}
                classes="link flex min-h-11 items-center px-2.5 font-semibold"
              >
                {s.label}
              </SectionLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

interface IStory {
  /** portable text */
  json: string;
  /** past `STORY_CLAMP` characters: cut short behind "Read the full story" */
  clamp: boolean;
}

function Story({ json, clamp }: IStory) {
  const id = useId();
  const heading_id = `${id}-heading`;
  const body_id = `${id}-body`;
  const [open, set_open] = useState(false);
  // past the clamp by characters, yet a wide column can still fit it all: what
  // the box measures decides the fade and the button. the server assumes a cut
  const [cut, set_cut] = useState(true);
  const clamped = clamp && !open;
  const body = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);

  // overflow hides the rest from the eye alone: a link under the fade or past
  // it would still take focus, and scroll the box rather than open it
  // biome-ignore lint/correctness/useExhaustiveDependencies: json brings new links and cut mounts or drops the fade, and either moves the line links are cut at
  useEffect(() => {
    const box = body.current;
    if (!box) return;
    const links = Array.from(box.querySelectorAll("a"));
    if (!clamped) {
      box.style.maxHeight = "";
      for (const a of links) a.inert = false;
      return;
    }
    const sync = () => {
      // max-h-120 is the cap; the cut moves up to the last whole line under
      // it, so the fade never ends through a line's glyphs
      box.style.maxHeight = "";
      box.style.maxHeight = `${last_line_bottom(box, box.clientHeight)}px`;
      set_cut(box.scrollHeight > box.clientHeight);
      const limit = fade.current
        ? fade.current.getBoundingClientRect().top
        : box.getBoundingClientRect().bottom;
      for (const a of links) a.inert = a.getBoundingClientRect().bottom > limit;
    };
    sync();
    // the box's own size, and the text's as it reflows inside it
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [clamped, cut, json]);

  return (
    <section
      id={ANCHOR.story}
      aria-labelledby={heading_id}
      className={`flex min-w-0 flex-col gap-4 ${ANCHORED}`}
    >
      <h2 id={heading_id} className={SECTION_HEADING}>
        Our story
      </h2>
      {/* no gap over the button: while clamped, the fade is the gap */}
      <div className="flex flex-col">
        <div id={body_id} ref={body} className={clamp ? story_box(open) : ""}>
          <RichText
            readOnly
            content={{ value: json }}
            classes={{
              field:
                "flex max-w-3xl flex-col gap-4 text-base leading-relaxed md:text-lg",
            }}
          />
          {clamp && cut && (
            <div
              ref={fade}
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-background ${open ? "opacity-0 transition-opacity duration-slow ease-in" : ""}`}
            />
          )}
        </div>
        {clamp && (open || cut) && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body_id}
            onClick={() => set_open((x) => !x)}
            className="link min-h-11 self-start font-bold"
          >
            {open ? "Show less" : "Read the full story"}
          </button>
        )}
      </div>
    </section>
  );
}

/** a story past the clamp. opening grows the box to its content's height
 * where `interpolate-size` is supported, and snaps where it is not; closing
 * snaps, since the cut is measured against the box at rest. open, it clips
 * the block axis alone, so a link's focus ring at the column's edge shows */
function story_box(open: boolean): string {
  return open
    ? "relative max-h-max overflow-y-clip transition-[max-height] duration-slow ease-out [interpolate-size:allow-keywords]"
    : "relative max-h-120 overflow-hidden";
}

/** the bottom of the last whole line that ends within `cap` of `box`'s top,
 * measured from that top. lines are counted down each block that holds text,
 * in steps of its line height */
function last_line_bottom(box: HTMLElement, cap: number): number {
  const top = box.getBoundingClientRect().top;
  const texts = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const blocks = new Set<HTMLElement>();
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    if (!node.textContent?.trim()) continue;
    let el = node.parentElement;
    while (
      el &&
      el !== box &&
      getComputedStyle(el).display.startsWith("inline")
    ) {
      el = el.parentElement;
    }
    if (el && el !== box) blocks.add(el);
  }
  let end = 0;
  for (const block of blocks) {
    const r = block.getBoundingClientRect();
    if (r.top - top >= cap) break;
    const line = Number.parseFloat(getComputedStyle(block).lineHeight);
    if (Number.isNaN(line) || line <= 0) continue;
    const fit = Math.min(
      Math.round(r.height / line),
      Math.floor((cap - (r.top - top) + 0.5) / line)
    );
    if (fit > 0) end = r.top - top + fit * line;
  }
  return end || cap;
}

interface ISection {
  id: string;
  heading: string;
  children: ReactNode;
}

function Section({ id, heading, children }: ISection) {
  const heading_id = useId();
  return (
    <section
      id={id}
      aria-labelledby={heading_id}
      className={`flex flex-col gap-3 ${ANCHORED}`}
    >
      <h2 id={heading_id} className={SECTION_HEADING}>
        {heading}
      </h2>
      {children}
    </section>
  );
}
