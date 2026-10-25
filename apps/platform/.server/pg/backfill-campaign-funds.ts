/**
 * BG-1943: fold org-owned legacy funds into `campaigns`, so a nonprofit's own
 * fundraisers live under one model with one editor, one public url and one way
 * of computing totals. Supporter-created funds stay as `funds`.
 *
 * Idempotent and re-runnable: the unique `campaigns.legacy_fund_id` is the
 * ledger, so a fund already folded is skipped. Dry-run by default — it only
 * counts what it would create; pass `--write` to apply.
 *
 * It copies each eligible fund into `campaigns` (slug/name/banner/logo/videos/
 * description to the same columns; `featured`/`active` to `status`, `expiration`
 * to `ends_at`; `fund_donate_methods`/`increments` and the target xor across),
 * and every `fund_members` row into `campaign_members` (the data model keeps
 * several beneficiaries). It never rewrites donation rows: a folded fund's
 * historic settled gifts keep riding `dists.fund_id`, which the recreated
 * `v_campaign_total_usd` now adds via `legacy_fund_id`.
 *
 * Runs with bun (it reaches the drizzle schema through the repo's path
 * aliases). Never against production in a dev session.
 *
 *   bun .server/pg/backfill-campaign-funds.ts            # dry-run, counts only
 *   bun .server/pg/backfill-campaign-funds.ts --write    # apply
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "$/pg/db";
import {
  campaign_members,
  campaigns,
  type TCampaignStatus,
} from "$/pg/schema/campaign";
import { fund_members, funds } from "$/pg/schema/fund";
import { user_npo_memberships } from "$/pg/schema/user";

export interface BackfillCounts {
  /** org-owned funds whose creator is a member of the owning org */
  org_funds: number;
  /** of those, already folded into a campaign on a prior run */
  already_migrated: number;
  /** campaigns created this run (what a dry-run would create) */
  campaigns_created: number;
  /** fund_members rows copied into campaign_members */
  members_copied: number;
}

/** a fund's open/closed state maps onto the campaign status ladder. an expired
 * `live` campaign reads as ended from `ends_at`, as `campaign_shown_status` does,
 * so expiry needs no separate status */
function status_of(f: {
  active: boolean;
  published: boolean;
}): TCampaignStatus {
  if (!f.active) return "ended";
  if (!f.published) return "draft";
  return "live";
}

export async function backfill_campaign_funds(
  opts: { dry_run?: boolean } = {}
): Promise<BackfillCounts> {
  const dry_run = opts.dry_run ?? false;

  // org-owned funds whose creator is a member of the owning org; a fund whose
  // `npo_owner` is set but whose creator never joined that org is left alone
  const org_funds = await db
    .select()
    .from(funds)
    .where(
      and(
        isNotNull(funds.npo_owner),
        sql`EXISTS (SELECT 1 FROM ${user_npo_memberships} WHERE ${user_npo_memberships.user_id} = ${funds.creator_id} AND ${user_npo_memberships.npo_id} = ${funds.npo_owner})`
      )
    )
    .orderBy(asc(funds.created_at));

  const migrated = await db
    .select({ fund_id: campaigns.legacy_fund_id })
    .from(campaigns)
    .where(isNotNull(campaigns.legacy_fund_id));
  const done = new Set(migrated.map((r) => r.fund_id));

  const counts: BackfillCounts = {
    org_funds: org_funds.length,
    already_migrated: 0,
    campaigns_created: 0,
    members_copied: 0,
  };

  for (const f of org_funds) {
    if (done.has(f.id)) {
      counts.already_migrated++;
      continue;
    }

    const members = await db
      .select({ npo_id: fund_members.npo_id, position: fund_members.position })
      .from(fund_members)
      .where(eq(fund_members.fund_id, f.id));

    if (dry_run) {
      counts.campaigns_created++;
      counts.members_copied += members.length;
      continue;
    }

    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id,
        owner_npo_id: f.npo_owner,
        creator_id: f.creator_id,
        name: f.name,
        // funds.slug is a nullable unique; a slugless fund keeps its stable id
        slug: f.slug ?? f.id,
        description_pt: f.description_pt,
        description_v2: f.description_v2,
        banner: f.banner,
        logo: f.logo,
        videos: f.videos,
        status: status_of(f),
        published_at: f.published ? f.created_at : null,
        ends_at: f.expiration,
        donate_methods: f.fund_donate_methods,
        increments: f.increments,
        target_number: f.target_number,
        target_smart: f.target_smart,
        hide_bg_tip: f.hide_bg_tip,
        legacy_fund_id: f.id,
        created_at: f.created_at,
      });
      if (members.length > 0) {
        await tx.insert(campaign_members).values(
          members.map((m) => ({
            campaign_id: id,
            npo_id: m.npo_id,
            position: m.position,
          }))
        );
      }
    });

    counts.campaigns_created++;
    counts.members_copied += members.length;
  }

  return counts;
}

const is_entry =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_entry) {
  const dry_run = !process.argv.includes("--write");
  const counts = await backfill_campaign_funds({ dry_run });
  console.log(
    `backfill-campaign-funds (${dry_run ? "dry-run" : "live"}): ${JSON.stringify(counts)}`
  );
  if (dry_run) console.log("dry-run only; pass --write to apply");
  process.exit(0);
}
