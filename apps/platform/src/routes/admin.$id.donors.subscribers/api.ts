import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { resp, search } from "@/helpers/https";
import {
  donor_billing_progress,
  npo_subscription_summary,
  npo_subscription_trends,
  npo_subscriptions,
} from "$/pg/queries/subscription";
import type { Route } from "./+types/route";
import { subs_search } from "./helpers";

export const loader = async (x: Route.LoaderArgs) => {
  const npo_id = x.context.get(admin_ctx);

  const p = safeParse(subs_search, search(x.url));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const { limit = 20, ...q } = p.output;

  // kick page query first so per-row billing can fan out in parallel with
  // summary/trends instead of waiting on the top-level Promise.all.
  const page_p = npo_subscriptions(npo_id, { ...q, limit });
  const summary_p = npo_subscription_summary(npo_id, "month");
  const trends_p = npo_subscription_trends(npo_id);

  const page = await page_p;

  // per-sub billing progress: month for "billed" + "pending this month",
  // year for "pending this year"
  const progress_p = Promise.all(
    page.items.map(async (s) => {
      const [m, y] = await Promise.all([
        donor_billing_progress(s.sub_ids, s.subs, "month"),
        donor_billing_progress(s.sub_ids, s.subs, "year"),
      ]);
      return {
        billed_month: m.billed_usd,
        pend_month: Math.max(0, m.expected_usd - m.billed_usd),
        pend_year: Math.max(0, y.expected_usd - y.billed_usd),
      };
    })
  );

  const [summary, trends, progress] = await Promise.all([
    summary_p,
    trends_p,
    progress_p,
  ]);

  const subscribers = page.items.map((s, i) => ({
    from_email: s.from_email,
    from_name: s.from_name,
    active_count: s.active_count,
    ...progress[i],
  }));

  return {
    page: { items: subscribers, next: page.next },
    summary,
    trends,
  };
};
