import { Copier, ExtLink, Image } from "@better-giving/ui";
import { href } from "react-router";
import laira_waiving from "#/assets/laira/laira-waiving.webp";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/wp-plugin")}`,
    title: `WordPress Plugin | ${app_name}`,
    description: `Add ${app_name}'s free, no-fee donation form to any WordPress site. Install the plugin, embed the form, and start accepting card, crypto, stock, and DAF gifts.`,
  });

export default function WpPlugin() {
  return (
    <div className="page mt-16 content-start pb-16 @container">
      <h1 className="text-center @6xl:text-left text-4xl @6xl:text-5xl @6xl:leading-tight text-pretty mb-4">
        {app_name} Wordpress plugin documentation
      </h1>
      <div className="py-5">
        <h2 className="mb-4 text-lg text-primary uppercase text-center">
          Installing the WordPress {app_name} Donation Form Plugin
        </h2>
        <ol className="list-decimal">
          <li>
            Download the {app_name}{" "}
            <ExtLink
              href="https://github.com/AngelProtocolFinance/bg-donation-plugins/releases/download/v0.2/wordpress.zip"
              className="link"
            >
              Wordpress Plugin
            </ExtLink>{" "}
            (ZIP file).
            <p className="text-gray-11">
              SHA256 Checksum:
              34f1aa11ab99e691e290b128d11d019cc9f7cb29f14f01f921b03835316880ce
            </p>
          </li>
          <li>
            Install the plugin by uploading the ZIP file to your Wordpress
            server, via the WP-Admin interface.
          </li>
          <li>Activate the {app_name} Donation Form plugin</li>
        </ol>
      </div>
      <div className="py-5">
        <h2 className="mb-4 text-lg text-primary uppercase text-center">
          Using and configuring {app_name} Donation Form Shortcode
        </h2>
        <div>
          The shortcode used to insert a {app_name} donation form into your
          wordpress blocks, pages and/or posts is <em>bg_donation_form</em>.
        </div>
        <div className="py-2">
          At a minimum, the following MUST be provided for the shortcode to work
          correctly and render the donation form: a Nonprofit Account ID. This
          is the number that was assigned to your nonprofit when you signed up
          with {app_name} and is unique to it (ex. 121).
        </div>
        <div className="mx-auto flex max-w-md gap-4 card shadow-lift-card my-4">
          <Image
            alt="Laira mascot waving"
            src={laira_waiving}
            className="max-sm:place-self-center"
            width={30}
          />
          <span>
            <strong>NOTE:</strong> If you do not know your Nonprofit Account ID,
            log in and open your nonprofit's dashboard. The ID is the number in
            its web address (ex: https://better.giving/admin/121).
          </span>
        </div>
        <div className="py-5">
          Below is an example of the minimum {app_name} donation form shortcode
          that would be needed in order to render a working component in
          Wordpress. With the minimum code, all optional settings will set to
          their defaults.
          <CodeCopy snippet="[bg_donation_form id=121]" />
        </div>
        <div className="py-10">
          The following are additional, optional configuration arguments that
          may be passed to further customize and configure your Donation Form
          settings and appearance from the default:
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Allowed Values</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-sm">
                  <td>
                    <Code snippet="currentsplitpct" />
                  </td>
                  <td>
                    Set a percentage of a to be split to the current account.
                    Donors can still adjust the split from this starting
                    suggested value. Defaults to 50%.
                  </td>
                  <td>0-100</td>
                  <td>
                    <CodeCopy snippet="currentsplitpct=20" />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="splitdisabled" />
                  </td>
                  <td>
                    Locks split to current percentage, preventing donors from
                    changing it. This will hide the split slider screen.
                    Defaults to 0.
                  </td>
                  <td>0 (not disabled) OR 1 (disabled)</td>
                  <td>
                    <CodeCopy snippet="splitdisabled=1" />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="showdescription" />
                  </td>
                  <td>Show or hide the description text. Defaults to shown.</td>
                  <td>0 (not shown) OR 1 (shown)</td>
                  <td>
                    <CodeCopy snippet="showdescription=0" />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="showtitle" />
                  </td>
                  <td>Show or hide the title text. Defaults to shown.</td>
                  <td>0 (not shown) OR 1 (shown)</td>
                  <td>
                    <CodeCopy snippet="showtitle=0" />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="description" />
                  </td>
                  <td>Custom description text to show under the title.</td>
                  <td />
                  <td>
                    <CodeCopy snippet={`description="Custom description..."`} />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="title" />
                  </td>
                  <td>
                    Custom title text to show at the top of the donation form.
                  </td>
                  <td />
                  <td>
                    <CodeCopy snippet={`title="Custom title"`} />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="methods" />
                  </td>
                  <td>
                    Define the payment method tabs to show and their order via a
                    comma separated string.
                  </td>
                  <td>
                    Valid methods: "stocks", "daf", "stripe" (ie. credit cards),
                    "crypto"
                  </td>
                  <td>
                    <CodeCopy snippet={`methods="crypto,stripe"`} />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="accentprimary" />
                  </td>
                  <td>
                    Set the primary accent color to your Nonprofit's brand
                    color.
                  </td>
                  <td>HEX color 3 or 6 digits (must start with '#')</td>
                  <td>
                    <CodeCopy snippet={`accentprimary=#dd8943"`} />
                  </td>
                </tr>
                <tr className="text-sm">
                  <td>
                    <Code snippet="accentsecondary" />
                  </td>
                  <td>
                    Set the secondary accent color to your Nonprofit's brand
                    color.
                  </td>
                  <td>HEX color 3 or 6 digits (must start with '#')</td>
                  <td>
                    <CodeCopy snippet={`accentsecondary="#dd8943"`} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  snippet: string;
};

function Code({ snippet = "" }: Props) {
  return <div className="max-sm:text-sm font-mono py-4">{snippet}</div>;
}

function CodeCopy({ snippet = "" }: Props) {
  return (
    <span className="flex gap-2">
      <Code snippet={snippet} />
      <Copier classes={{ icon: "w-4 h-4 hover:text-primary" }} text={snippet} />
    </span>
  );
}
