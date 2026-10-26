import { donation_transfer_notif } from "emails";
import { type ActionFunction, href } from "react-router";
import * as v from "valibot";
import { get_session } from "#/.server/auth";
import { to_fn } from "#/.server/donation-recipient";
import { report_null } from "#/errors/report";
import { emails } from "@/constants/common";
import { to_id } from "@/donations/schema";
import { send_email } from "$/email";
import { base_url } from "$/env";
import { campaign_by_id } from "$/pg/queries/campaign";

const positive_decimal = v.pipe(
  v.string(),
  v.regex(/^\d+(\.\d+)?$/),
  v.check((s) => +s > 0)
);

const stocks_details = v.object({
  ticker: v.pipe(v.string(), v.regex(/^[A-Za-z0-9.-]{1,10}$/)),
  shares: positive_decimal,
  amount: positive_decimal,
});

// a firm name, never a link: no `:` (so no scheme) or `@`, and no `word.tld` a
// mail client would autolink as a bare host ("T. Rowe", "Co., Inc." keep the
// space or comma). every action carries its own message: the 400 hands it to the
// donor's form, and valibot's default ones quote the input back.
const custodian = v.pipe(
  v.string("Enter your custodian's name"),
  v.trim(),
  // ios smart punctuation
  v.transform((s) => s.replace(/[‘’]/g, "'")),
  v.maxLength(100, "Keep it to 100 characters"),
  v.regex(
    /^[\p{L}\d &'.,()*/-]+$/u,
    "Use letters, numbers, spaces and & ' . , ( ) * / - only"
  ),
  v.check(
    (s) => !/[\p{L}\d-]\.\p{L}{2,}/u.test(s),
    "Enter the firm's name, not a web address"
  )
);

const ira_qcd_details = v.object({
  amount: positive_decimal,
  custodian: v.optional(custodian),
});

// best-effort, per-instance guard — not a global 5-minute dedup window. the app
// deploys as vercel serverless functions, so every concurrent instance holds
// its own map: this only collapses a rapid double-submit that lands on the same
// warm instance, and a retry routed to another instance still sends a
// duplicate. accepted trade-off — these notifications go to the internal team,
// so an occasional duplicate is cheaper than a shared store on this path.
const DEDUP_TTL = 5 * 60 * 1000;
const seen = new Map<string, number>();

// the caller names *which* recipient, never what the recipient is called or
// where it lives. this route is unauthenticated by necessity — the stocks and
// ira/qcd rails record no donation to bind a caller to, and anonymous donors
// are real — so every field it does accept ends up in a mail to the whole team
// under the platform's own sender. a caller-supplied `recipient_url` in that
// mail is a phishing link wearing our provenance; a caller-supplied
// `recipient_name` is a fabricated recipient. both are derivable from the id,
// so neither is asked for.
const campaign_id = v.optional(v.pipe(v.string(), v.uuid()));

const schema = v.variant("type", [
  v.object({
    type: v.literal("stocks"),
    recipient_id: to_id,
    campaign_id,
    details: stocks_details,
  }),
  v.object({
    type: v.literal("ira_qcd"),
    recipient_id: to_id,
    campaign_id,
    details: ira_qcd_details,
  }),
]);

export const action: ActionFunction = async ({ request }) => {
  // a malformed body gets the schema failure's 400, not a thrown 500
  const body = await request.json().catch(() => null);
  const result = v.safeParse(schema, body);
  if (!result.success) {
    const custodian_error = v.flatten<typeof schema>(result.issues).nested?.[
      "details.custodian"
    ]?.[0];
    return Response.json(
      custodian_error
        ? { ok: false, errors: { custodian: custodian_error } }
        : { ok: false },
      { status: 400 }
    );
  }

  const data = result.output;

  // resolves against the live record, so an id naming nothing — or naming a
  // deactivated npo, which `to_fn` also refuses — never reaches an inbox. the
  // team's notification is then about a recipient that exists.
  const to = await to_fn(data.recipient_id);
  if (!to) {
    return Response.json({ ok: false }, { status: 400 });
  }

  // another nonprofit's campaign, or a draft, is dropped. a published campaign
  // this nonprofit owns is named even after it closes: the donor may already
  // have the transfer instructions, and the team still needs the notice.
  // new gifts are blocked on the campaign page, which renders no donate box
  // once the campaign is closed.
  let campaign: { name: string; url?: string } | undefined;
  if (data.campaign_id) {
    const row = await campaign_by_id(data.campaign_id);
    const owned =
      row && to.to_type === "npo" && row.owner_npo_id === Number(to.to_id);
    if (owned && row && row.status !== "draft") {
      campaign = {
        name: row.name,
        ...(row.owner_slug
          ? { url: `${base_url}/org/${row.owner_slug}/${row.slug}` }
          : {}),
      };
    }
  }

  // after the lookup, so the map records what was mailed rather than what was
  // asked for — a rejected id must not hold a key that then suppresses the
  // same notification once the recipient resolves.
  const key = JSON.stringify(data);
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < DEDUP_TTL) {
    return Response.json({ ok: true });
  }
  // prune on write so a long-lived warm instance's map doesn't grow with every
  // notification it has ever seen. age-based only — it reclaims keys once the
  // window passes, not against a burst of distinct payloads inside one window.
  for (const [k, t] of seen) {
    if (now - t >= DEDUP_TTL) seen.delete(k);
  }
  seen.set(key, now);

  const path =
    to.to_type === "fund"
      ? href("/campaigns/:fund_id", { fund_id: to.to_id })
      : href("/org/:org", { org: to.to_id });

  const { user } = await get_session(request);
  const donor_email = user?.email ?? "Anonymous";

  const { node, subject } = donation_transfer_notif.template({
    type: data.type,
    recipient_name: to.to_name,
    recipient_url: `${base_url}${path}`,
    donor_email,
    details: data.details,
    ...(campaign
      ? { campaign_name: campaign.name, campaign_url: campaign.url }
      : {}),
  });

  await send_email({ node, subject, to: Object.values(emails) }).catch(
    report_null
  );

  return Response.json({ ok: true });
};
