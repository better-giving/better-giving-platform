import { TabPanel, Tabs } from "@better-giving/ui";
import { type ReactNode, useId, useState } from "react";
import { RichText, to_text } from "#/components/rich-text";
import { BrandBand } from "../brand-band";
import { GivePanel } from "../give-panel";
import { names_kind, type TOrgItem } from "../items";
import { ItemsByCount, ShowMoreGrid } from "../items-by-count";
import { OrgMark } from "../org-mark";
import { OrgMeta } from "../org-meta";
import { OrgName } from "../org-name";
import { QuoteStrip } from "../quote-strip";
import { SECTION_HEADING } from "../section-heading";
import { VideoSet } from "../video-set";
import { OrgPageFrame } from "./org-page-frame";
import type { IOrgLayout } from "./types";
import { FailedLine, give_label } from "./ways-to-help";

type TKind = keyof IOrgLayout["failed"];
type TTab = TKind | "messages";

const KINDS: TKind[] = ["give", "programs", "videos"];

const LABEL: Record<Exclude<TTab, "give">, string> = {
  programs: "Programs",
  videos: "Videos",
  messages: "Messages",
};

/** short or no story, 4+ items: a compact identity hero, then a tab per kind
 * of item. a kind with one item sits above the tabs as Featured, the kind
 * with the most items is the first tab, and a lone kind gets no tabs at all */
export function Hub(props: IOrgLayout) {
  const { failed, now, messages } = props;
  const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
  const lists = {
    give: props.give,
    programs: props.programs,
    videos: props.videos,
  };

  const featured = KINDS.filter(
    (k) => !failed[k] && lists[k].length === 1
  ).flatMap((k): TOrgItem[] => lists[k]);
  const featured_cards = featured.filter((x) => x.kind !== "video");
  const featured_video = featured.filter((x) => x.kind === "video");
  // a failed kind keeps its tab so its line is seen; sort is stable, so ties
  // keep campaigns, programs, videos
  const tabs: TTab[] = KINDS.filter(
    (k) => failed[k] || lists[k].length > 1
  ).sort((a, b) => lists[b].length - lists[a].length);
  if (messages.length > 0) tabs.push("messages");

  const label = (t: TTab) => (t === "give" ? give_label(lists.give) : LABEL[t]);

  /** a tab's label with its item count in muted ink. messages arrive a page
   * at a time, so they have no count to give */
  function tab_label(t: TTab): ReactNode {
    if (t === "messages" || failed[t]) return label(t);
    return (
      <>
        {label(t)} <span className="text-gray-11">{lists[t].length}</span>
      </>
    );
  }

  function content(t: TTab): ReactNode {
    if (t === "messages") {
      return (
        <QuoteStrip
          messages={messages}
          tone="light"
          on_more={props.on_more_messages}
        />
      );
    }
    // what loaded, then the line for what didn't
    return (
      <div className="flex flex-col gap-4">
        {t === "videos" ? (
          <VideoSet videos={lists.videos} />
        ) : (
          lists[t].length > 0 && <ShowMoreGrid items={lists[t]} now={now} />
        )}
        {failed[t] && <FailedLine kind={t} />}
      </div>
    );
  }

  return (
    <OrgPageFrame page={props} hero_donate={hero_donate}>
      <HubHero page={props} donate_ref={set_hero_donate} />
      <div className="page flex flex-col gap-8 py-8 md:gap-10 md:py-10">
        {featured.length > 0 && (
          <Section heading="Featured">
            <div className="flex flex-col gap-4">
              {/* the video beside them is a kind too */}
              <ItemsByCount
                items={featured_cards}
                now={now}
                show_kind={names_kind(featured)}
              />
              {/* a lone video at the content's full width outweighs the
                  tabs under it, so it takes the reading measure, on the
                  heading's edge */}
              <VideoSet videos={featured_video} classes="w-full max-w-3xl" />
            </div>
          </Section>
        )}
        {tabs.length === 1 && (
          <Section heading={label(tabs[0])}>{content(tabs[0])}</Section>
        )}
        {tabs.length > 1 && (
          <Tabs
            items={tabs.map((t) => ({ value: t, label: tab_label(t) }))}
            defaultValue={tabs[0]}
          >
            {tabs.map((t) => (
              <TabPanel key={t} value={t} className="pt-6">
                <h2 className="sr-only">{label(t)}</h2>
                {content(t)}
              </TabPanel>
            ))}
          </Tabs>
        )}
      </div>
    </OrgPageFrame>
  );
}

interface IHubHero {
  page: IOrgLayout;
  donate_ref: (el: HTMLElement | null) => void;
}

/** the tint band: the mark, the facts over the name, the tagline and story,
 * and the give card. a phone stacks the facts, the mark beside the name, the
 * tagline, the card, then the story, so Donate lands in its first screen.
 * from md the mark and the card are columns either side of the text, whose
 * empty last row takes up a taller column's height */
function HubHero({ page, donate_ref }: IHubHero) {
  const { npo } = page;
  const tagline = npo.tagline?.trim();
  const has_story = !!to_text(npo.overview_pt).trim();
  return (
    <BrandBand tone="tint" classes="border-b border-hairline py-6 md:py-10">
      <div className="page grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 md:grid-cols-[auto_minmax(0,1fr)_18rem] md:grid-rows-[auto_auto_auto_auto_1fr] md:items-start md:gap-x-6 md:gap-y-0 lg:grid-cols-[auto_minmax(0,1fr)_24rem] lg:gap-x-8">
        <OrgMark
          name={npo.name}
          logo={npo.logo}
          size="lg"
          classes="row-start-2 md:row-span-full md:row-start-1"
        />
        <OrgMeta
          npo={npo}
          credential={page.credential}
          classes="col-span-2 row-start-1 md:col-span-1 md:col-start-2"
        />
        <OrgName
          name={npo.name}
          scale="sm"
          classes="row-start-2 md:col-start-2 md:pt-3"
        />
        {tagline && (
          <p className="col-span-2 max-w-2xl text-lg md:col-span-1 md:col-start-2 md:row-start-3 md:pt-3">
            {tagline}
          </p>
        )}
        <GivePanel
          name={npo.name}
          banner={npo.image}
          donate_to={page.donate_to}
          donate_ref={donate_ref}
          classes="col-span-2 md:col-span-1 md:col-start-3 md:row-span-full md:row-start-1"
        />
        {has_story && (
          <RichText
            readOnly
            content={{ value: npo.overview_pt }}
            classes={{
              container:
                "col-span-2 md:col-span-1 md:col-start-2 md:row-start-4 md:pt-3",
              field: "flex max-w-2xl flex-col gap-2 text-gray-11",
            }}
          />
        )}
      </div>
    </BrandBand>
  );
}

interface ISection {
  heading: string;
  children: ReactNode;
}

function Section({ heading, children }: ISection) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 md:gap-4">
      <h2 id={id} className={SECTION_HEADING}>
        {heading}
      </h2>
      {children}
    </section>
  );
}
