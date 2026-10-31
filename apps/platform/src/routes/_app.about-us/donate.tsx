import type { ComponentProps } from "react";
import { donation_recipient_init, Steps } from "#/components/donation";

// Steps takes a union — a fresh mount or a resumed donation state; `Extract`
// picks the fresh-mount branch (a plain `Omit` over the union keeps nothing).
type Mount = Omit<
  Extract<ComponentProps<typeof Steps>, { recipient: unknown }>,
  "base_url"
>;

/**
 * how the form is mounted here: better giving's own npo row (id 1), every
 * payment rail (`config: null` → `all_method_ids`), no session prefill.
 * `hide_bg_tip` mirrors the row's setting — the client prop is display-only,
 * the money path reads the row server-side.
 * `base_url` is the one piece that isn't static: it comes in as a prop from the
 * route loader (the request origin), so the post-payment return url lands on
 * the host the donor is actually on.
 * `hide_unavailable_express`: nobody lands here to donate, so an express rail
 * that can't be offered (adblocked paypal sdk, ineligible currency) drops out
 * quietly rather than throwing a modal over the page. mid-payment failures
 * still prompt here, same as everywhere.
 *
 * this mount is static where `/donate/1` reads the npo row: `config: null`
 * discards `increments`, `freq_opts` and `method_ids`, and
 * `donation_recipient_init` hardcodes `donor_address_required: false`. so
 * restricting bg's own row's donate methods, or turning on donor address, moves
 * `/donate/1` and leaves this band where it is. all display-only — the money
 * path reads the row server-side either way.
 */
export const donate_mount = {
  source: "bg-marketplace",
  mode: "live",
  config: null,
  recipient: donation_recipient_init({ hide_bg_tip: true }),
  user: undefined,
  program: undefined,
  hide_unavailable_express: true,
} satisfies Mount;

interface IDonate {
  base_url: string;
  classes?: string;
}

export function Donate({ base_url, classes = "" }: IDonate) {
  return (
    <section className={classes} aria-labelledby="donate-heading">
      <div className="page grid justify-items-center">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">
          Support Better Giving
        </p>
        <h2
          id="donate-heading"
          className="section-heading mt-3 text-center max-w-2xl"
        >
          Free for nonprofits isn't free to run
        </h2>
        <p className="mt-4 text-gray-11 leading-relaxed text-pretty text-center max-w-2xl">
          Better Giving is a 501(c)(3) nonprofit. Donations here pay for the
          servers, the support, and the engineering behind tools nonprofits
          never get billed for.
        </p>
        <Steps
          {...donate_mount}
          base_url={base_url}
          classes="mt-11 max-w-2xl rounded-card shadow-lift-card"
        />
      </div>
    </section>
  );
}
