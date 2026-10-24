import { useState } from "react";
import { RichText, to_text } from "#/components/rich-text";
import { DonateButton } from "../donate";
import { first_sentence } from "../first-sentence";
import { OrgBanner } from "../org-banner";
import { OrgMeta } from "../org-meta";
import { OrgName } from "../org-name";
import { QuoteStrip } from "../quote-strip";
import { OrgPageFrame } from "./org-page-frame";
import type { IOrgLayout } from "./types";
import { WaysToHelp } from "./ways-to-help";

const LEAD =
  "[&>p:first-child]:text-lg [&>p:first-child]:font-bold md:[&>p:first-child]:text-xl";

/** a long story, and 0-3 items: an editorial reading column on the page's
 * left edge. the name and its deck, Donate under them, the banner across the
 * page, the story, the donors' words, then whatever there is to give to */
export function Letter(props: IOrgLayout) {
  const { npo } = props;
  const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
  const tagline = npo.tagline?.trim();
  const deck = tagline || first_sentence(to_text(npo.overview_pt));

  return (
    <OrgPageFrame page={props} hero_donate={hero_donate}>
      <div className="page pt-6 pb-10 md:pt-12 md:pb-16">
        {/* each block but the banner keeps the reading measure, one level in
            from the page, starting on its left edge with the header's */}
        <article className="flex flex-col gap-5 md:gap-7">
          <div className="flex max-w-3xl flex-col gap-4">
            <OrgMeta npo={npo} credential={props.credential} />
            <OrgName name={npo.name} scale="lg" />
            {/* a deck taken from the story is its opening words again, which
                the story itself reads out a moment later */}
            {deck && (
              <p
                aria-hidden={!tagline || undefined}
                className="line-clamp-3 text-lg leading-snug text-gray-11 md:text-2xl"
              >
                {deck}
              </p>
            )}
            <DonateButton
              ref={set_hero_donate}
              to={props.donate_to}
              size="lg"
              classes="mt-1 md:self-start"
            />
          </div>
          {npo.image && (
            // the page's full width, edge on edge with the header's
            <figure>
              <OrgBanner src={npo.image} classes="rounded" />
            </figure>
          )}
          <RichText
            readOnly
            content={{ value: npo.overview_pt }}
            // the first block is the lead, set a size up, when it is a
            // paragraph: a heading or a list keeps its own setting. a deck
            // from the story already set its opening, so the lead would
            // repeat it
            classes={{
              field: `flex max-w-3xl flex-col gap-5 leading-relaxed md:gap-6 md:text-lg ${tagline ? LEAD : ""}`,
            }}
          />
          <QuoteStrip
            messages={props.messages}
            tone="pull"
            on_more={props.on_more_messages}
            classes="max-w-3xl"
          />
          <WaysToHelp
            give={props.give}
            programs={props.programs}
            videos={props.videos}
            failed={props.failed}
            now={props.now}
            rows
            classes="max-w-3xl pt-3"
          />
        </article>
      </div>
    </OrgPageFrame>
  );
}
