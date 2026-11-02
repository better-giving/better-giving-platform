import { Marquee } from "@ark-ui/react/marquee";
import { static_url } from "#/constants/urls";

const partners = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  url: static_url(`partners/${i + 1}.webp`),
}));

interface IPartnersStrip {
  classes?: string;
}

/** horizontal partner logo strip — slow scroll, mkt pages */
export function PartnersStrip({ classes = "" }: IPartnersStrip) {
  return (
    <section className={`${classes} overflow-hidden py-8`}>
      <p className="text-center text-sm text-gray-11 px-6">
        Trusted by nonprofits, faith charities, schools &amp; universities
        worldwide
      </p>
      <Marquee.Root
        side="start"
        speed={30}
        autoFill
        pauseOnInteraction
        className="group relative w-full mt-5"
      >
        {/* the edges fade by mask, not by a fill laid over them: a fill would
            have to match the ground, which is white on a marketing page and
            gray on an org page */}
        <Marquee.Viewport className="w-full overflow-hidden mask-x-from-90%">
          <Marquee.Content className="animate-marquee-x group-data-paused:[animation-play-state:paused] motion-reduce:animate-none">
            <Marquee.Item className="flex items-center gap-16 px-8">
              {partners.map((p) => (
                <img
                  key={p.id}
                  src={p.url}
                  alt=""
                  className="h-13 w-auto object-contain grayscale opacity-60 transition group-hover:opacity-90"
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </Marquee.Item>
          </Marquee.Content>
        </Marquee.Viewport>
      </Marquee.Root>
    </section>
  );
}
