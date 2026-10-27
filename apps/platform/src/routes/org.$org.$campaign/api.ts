import { to_usd } from "@better-giving/ui/helpers";
import { data, href } from "react-router";
import { safeParse } from "valibot";
import { get_session } from "#/.server/auth";
import { can_preview } from "#/.server/can-preview";
import { moved } from "#/helpers/moved";
import { resp } from "@/helpers/https";
import { frequency } from "@/schemas";
import {
  campaign_accepts,
  campaign_donation_base_usd,
  campaign_donor_count,
  campaign_public,
  campaign_repeat_donor,
  campaign_settled_donation,
} from "$/pg/queries/campaign";
import { npo_get } from "$/pg/queries/npo";
import { reg_public_ein } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

/** a preview of an unpublished owner depends on who asked, so it stays out of
 * shared caches; the public page keeps whatever cache it already had */
const PRIVATE = { "cache-control": "private, no-store" };

export const headers: Route.HeadersFunction = ({
  loaderHeaders,
  errorHeaders,
}) => {
  const h: Record<string, string> = {};
  const cc = (errorHeaders ?? loaderHeaders).get("cache-control");
  if (cc) h["cache-control"] = cc;
  return h;
};

function prefill_amount(raw: string | null) {
  if (!raw) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return;
  return String(n);
}

function thanks_from(url: URL): {
  thanks_amount: string | null;
  thanks_name: string | null;
} {
  const raw = url.searchParams.get("donation_amount");
  const amount = raw == null ? Number.NaN : Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { thanks_amount: null, thanks_name: null };
  }
  const currency = url.searchParams.get("donation_currency")?.trim() ?? "";
  const usd = currency === "" || currency.toUpperCase() === "USD";
  const name = url.searchParams.get("donor_name")?.trim() ?? "";
  return {
    thanks_amount: usd ? to_usd(amount) : `${amount} ${currency}`,
    thanks_name: name === "" ? "You" : name,
  };
}

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const campaign = await campaign_public(params.org, params.campaign);
  if (!campaign || campaign.owner_npo_id == null) throw resp.status(404);
  const url = new URL(request.url);
  // a published owner with a slug lives at it; its id url is an alias. an
  // unpublished owner's slug stays out of this public, cached redirect
  if (
    /^\d+$/.test(params.org) &&
    campaign.owner_slug &&
    campaign.owner_published
  ) {
    throw moved(
      `${href("/org/:org/:campaign", { org: campaign.owner_slug, campaign: campaign.slug })}${url.search}`
    );
  }
  // the campaign page follows its owner: an unpublished owner's pages show only
  // to its own admins and to platform admins, as `/org/:org` does
  const preview = campaign.owner_published === false;
  if (preview && !(await can_preview(request, campaign.owner_npo_id))) {
    throw new Response(null, { status: 404, headers: PRIVATE });
  }
  const donation_id = url.searchParams.get("donation_id")?.trim() ?? "";
  const redirect_failed =
    url.searchParams.get("redirect_status")?.trim() === "failed";
  // a failed bank return still carries the charge in the url. that is not a
  // gift that landed, so the thank-you line and the feed highlight stay off.
  const thanks = redirect_failed
    ? { thanks_amount: null, thanks_name: null }
    : thanks_from(url);
  const count_base = donation_id !== "" && !redirect_failed;
  const [
    npo,
    donor_count,
    registration,
    thanks_settled,
    thanks_repeat,
    base_usd,
  ] = await Promise.all([
    npo_get(campaign.owner_npo_id),
    campaign_donor_count(campaign.id),
    reg_public_ein(campaign.owner_npo_id),
    donation_id === ""
      ? false
      : campaign_settled_donation(campaign.id, donation_id),
    donation_id === ""
      ? false
      : campaign_repeat_donor(campaign.id, donation_id),
    count_base ? campaign_donation_base_usd(campaign.id, donation_id) : null,
  ]);
  if (!npo || npo.active === false) throw resp.status(404);

  const amount = prefill_amount(url.searchParams.get("amount"));
  const freq_raw = url.searchParams.get("frequency");
  const freq_parsed = safeParse(frequency, freq_raw);
  const freq_opts = campaign.donate_frequencies ?? undefined;
  const offered = freq_opts ?? ["one-time"];
  const frequency_ok =
    freq_parsed.success && offered.includes(freq_parsed.output)
      ? freq_parsed.output
      : undefined;
  const monthly_default =
    campaign.campaign_type === "monthly" && offered.includes("monthly")
      ? "monthly"
      : undefined;

  const { user } = await get_session(request);
  const now = new Date();
  return data(
    {
      campaign,
      npo: {
        id: npo.id,
        name: npo.name,
        donor_address_required: npo.donor_address_required ?? false,
        hide_bg_tip: npo.hide_bg_tip,
        url: npo.url,
        ein: registration?.ein ?? null,
        // what the profile labels "EIN" when no approved 501(c)(3) ein backs it
        registration_number: npo.registration_number,
        hq_country: npo.hq_country,
      },
      closed: !campaign_accepts(campaign, now),
      now: now.toISOString(),
      base_url: url.origin,
      canonical: `${url.origin}/org/${params.org}/${params.campaign}`,
      prefill_amount_usd: amount,
      prefill_frequency: frequency_ok ?? monthly_default,
      donor_count,
      thanks_amount: thanks.thanks_amount,
      thanks_name: thanks.thanks_name,
      thanks_receipt:
        thanks.thanks_amount && donation_id
          ? `/donations/${encodeURIComponent(donation_id)}`
          : null,
      gift_failed: redirect_failed,
      // the return amount is the rail charge in the url currency. any return
      // with a donation id counts the gift base before settlement, net of tip
      // and the donor-covered fee. a stripe redirect_status of failed will not
      // settle, so it adds nothing.
      thanks_usd: count_base && !thanks_settled ? base_usd : null,
      thanks_settled,
      thanks_repeat,
      user: user
        ? {
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
          }
        : undefined,
    },
    preview ? { headers: PRIVATE } : undefined
  );
};
