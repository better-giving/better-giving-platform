import { useState } from "react";
import { DonateButton } from "../donate";
import { OrgBanner } from "../org-banner";
import { OrgMark } from "../org-mark";
import { OrgMeta } from "../org-meta";
import { OrgName } from "../org-name";
import { QuoteStrip } from "../quote-strip";
import { OrgPageFrame } from "./org-page-frame";
import type { IOrgLayout } from "./types";
import { WaysToHelp } from "./ways-to-help";

/** no story and nothing to list: one centred identity card on the page
 * ground, the banner as its top strip, then the mark, the name, the tagline,
 * the facts and Donate, with the donors' words under it. a list that failed
 * to load (so counted as nothing to list) keeps its line between the card and
 * the donors' words. all of it sits in the middle of main when
 * the page is shorter than the screen */
export function Card(props: IOrgLayout) {
  const { npo } = props;
  // the card's Donate, which the header waits on before showing its own
  const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
  const tagline = npo.tagline?.trim();

  return (
    <OrgPageFrame page={props} hero_donate={hero_donate}>
      <div className="page flex flex-1 flex-col justify-center py-8 md:py-12">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* a media frame, not `card`: the banner runs edge to edge, so the
              inset is the body's */}
          <article className="overflow-hidden bg-card rounded-card">
            <OrgBanner src={npo.image} />
            <div className="flex flex-col items-center gap-4 p-6 text-center md:gap-5">
              <OrgMark name={npo.name} logo={npo.logo} size="lg" />
              <div className="flex flex-col gap-2">
                <OrgName name={npo.name} scale="md" />
                {tagline && (
                  <p className="text-lg leading-snug text-gray-11 md:text-xl">
                    {tagline}
                  </p>
                )}
              </div>
              <OrgMeta
                npo={npo}
                credential={props.credential}
                classes="justify-center"
              />
              <DonateButton
                ref={set_hero_donate}
                to={props.donate_to}
                size="lg"
                classes="max-md:self-stretch"
              />
            </div>
          </article>
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
      </div>
    </OrgPageFrame>
  );
}
