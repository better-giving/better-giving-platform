import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { Explainer, Hub, Nonprofits, ReferralId } from "#/components/referrals";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { Earnings } from "./earnings";

export const meta: Route.MetaFunction = () => {
  return metas({
    title: "My referrals",
    description: "Track your referrals and earnings on Better Giving.",
  });
};
export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export default CacheRoute(Page);

function Page({ loaderData }: Route.ComponentProps) {
  const {
    base_url,
    referral_code,
    referreds,
    earnings,
    pending_total,
    payout,
    payout_min,
    payout_ltd,
    w_form,
  } = loaderData;
  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <h1 className="sr-only">My referrals</h1>
      <Explainer classes="mb-4" />
      <Hub classes="mb-8" />
      <h3 className="mt-8 mb-4 text-2xl">My referral ID and link</h3>
      <ReferralId
        classes="mb-8"
        referral_id={referral_code}
        base_url={base_url}
      />
      <Earnings
        classes="mb-8"
        earnings={{
          items: earnings.items,
          ...(earnings.next && { see_all: "earnings" }),
        }}
        payout={payout}
        payout_min={payout_min}
        pending_total={pending_total}
        payout_ltd={payout_ltd}
        w_form={w_form}
      />
      <Nonprofits npos={referreds} classes="mb-8" />
    </div>
  );
}
