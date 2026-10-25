import { useState } from "react";
import { RichText, to_text } from "#/components/rich-text";
import { BrandBand } from "../brand-band";
import { GivePanel } from "../give-panel";
import { OrgMark } from "../org-mark";
import { OrgMeta } from "../org-meta";
import { OrgName } from "../org-name";
import { QuoteStrip } from "../quote-strip";
import { OrgPageFrame } from "./org-page-frame";
import type { IOrgLayout } from "./types";
import { has_ways_to_help, WaysToHelp } from "./ways-to-help";

/** a short story or none, and 0-3 items: the hero on the deep band is the
 * whole pitch. the name, the tagline as its deck, the give card, then the short
 * story; from md the card is a column of its own beside the rest. whatever
 * there is to give to follows in one row, then the donors' words */
export function Poster(props: IOrgLayout) {
  const { npo } = props;
  // the card's Donate, which the header waits on before showing its own
  const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
  const has_story = !!to_text(npo.overview_pt).trim();
  const tagline = npo.tagline?.trim();
  const has_more = has_ways_to_help(props) || props.messages.length > 0;

  return (
    <OrgPageFrame page={props} hero_donate={hero_donate}>
      {/* with nothing after it, the band fills main down to the footer and
          centres the hero in it, leaving no bare page between them */}
      <BrandBand
        tone="deep"
        classes={`py-8 md:py-12 ${has_more ? "" : "flex flex-1 flex-col justify-center"}`}
      >
        <div className="page">
          {/* from md the empty 1fr rows above and below centre the left
              column as one block against the card */}
          <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:grid-rows-[1fr_auto_auto_1fr] md:gap-x-8 md:gap-y-0 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-x-16">
            <div className="flex flex-col gap-4 md:row-start-2 md:gap-5">
              <div className="flex items-center gap-3 md:gap-4">
                <OrgMark name={npo.name} logo={npo.logo} size="md" ring />
                <OrgMeta npo={npo} credential={props.credential} />
              </div>
              <OrgName name={npo.name} scale="lg" />
              {tagline && (
                <p className="text-lg leading-snug md:text-2xl">{tagline}</p>
              )}
            </div>
            <GivePanel
              name={npo.name}
              banner={npo.image}
              donate_to={props.donate_to}
              donate_ref={set_hero_donate}
              classes="mt-1 md:col-start-2 md:row-span-full md:mt-0 md:self-center"
            />
            {has_story && (
              <RichText
                readOnly
                content={{ value: npo.overview_pt }}
                // a story link keeps the band's ink: the editor's primary
                // link ink vanishes on the deep fill
                classes={{
                  container: "md:col-start-1 md:row-start-3 md:pt-5",
                  field:
                    "flex max-w-3xl flex-col gap-3 leading-relaxed md:text-xl [&_a]:text-primary-fg",
                }}
              />
            )}
          </div>
        </div>
      </BrandBand>
      <div className="page flex flex-col gap-8 py-8 empty:hidden md:py-10">
        <WaysToHelp
          give={props.give}
          programs={props.programs}
          videos={props.videos}
          failed={props.failed}
          now={props.now}
        />
        <QuoteStrip
          messages={props.messages}
          tone="light"
          on_more={props.on_more_messages}
        />
      </div>
    </OrgPageFrame>
  );
}
