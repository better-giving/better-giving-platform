import { Breadcrumb } from "@better-giving/ui";
import { href, Link, type LinksFunction } from "react-router";
import { richtext_styles } from "#/components/rich-text";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { ORG_SLUG_PROMPT } from "#/routes/admin.$id.campaigns/copy";
import { blank_init, CampaignForm } from "#/routes/admin.$id.campaigns/form";
import { campaign_link_base } from "#/routes/admin.$id.campaigns/link";
import type { Route } from "./+types/route";

export { ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("New campaign", matches);
export const links: LinksFunction = () => [...richtext_styles];

export default function Page({ loaderData }: Route.ComponentProps) {
  const { endow, programs, profile_to, origin } = loaderData;
  const id = String(endow.id);
  return (
    <div className="grid w-full min-w-0 max-w-4xl px-4 py-4 md:px-10 md:py-8 gap-6">
      <Breadcrumb
        items={[
          {
            label: "Campaigns",
            to: href("/admin/:id/campaigns", { id }),
          },
          {
            label: "New campaign",
            to: href("/admin/:id/campaigns/new", { id }),
          },
        ]}
      />
      {endow.slug ? (
        <CampaignForm
          init={blank_init(
            endow.donate_methods,
            endow.donate_frequencies,
            endow.hide_bg_tip ?? false
          )}
          programs={programs}
          locked={false}
          status={null}
          gift_count={0}
          fallback_methods={endow.donate_methods}
          fallback_frequencies={endow.donate_frequencies}
          settings_donation_to={`${href("/admin/:id/settings", { id })}?tab=donation`}
          link_base={campaign_link_base(origin, endow.slug)}
        />
      ) : (
        <div className="card grid gap-3">
          <p>{ORG_SLUG_PROMPT}</p>
          <Link to={profile_to} className="btn btn-primary w-fit">
            Organization
          </Link>
        </div>
      )}
    </div>
  );
}
