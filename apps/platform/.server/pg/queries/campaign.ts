import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { to_text } from "#/components/rich-text/helpers";
import type { DonateMethodId, IIncrement, TFrequency } from "@/schemas";
import { db } from "../db";
import { user } from "../schema/auth";
import {
  campaign_members,
  campaigns,
  type TCampaignStatus,
  type TCampaignType,
} from "../schema/campaign";
import { dists } from "../schema/dist";
import { donation_donors, donations } from "../schema/donation";
import { fund_members } from "../schema/fund";
import { npos } from "../schema/npo";
import { v_campaign_total_usd } from "../schema/views";
import { from_target, to_target } from "./fmt";
import type { DbOrTx } from "./helpers";

export interface ICampaignInput {
  id: string;
  owner_npo_id: number;
  creator_id: string;
  name: string;
  slug: string;
  campaign_type: TCampaignType | null;
  description_pt: string;
  banner: string | null;
  logo: string | null;
  videos: string[];
  ends_at: string | null;
  donate_methods: DonateMethodId[] | null;
  donate_frequencies: TFrequency[] | null;
  increments: IIncrement[] | null;
  target: string | undefined;
  hide_bg_tip: boolean;
  program_id: string | null;
  program_name: string | null;
}

export interface ICampaignPatch {
  name?: string;
  slug?: string;
  campaign_type?: TCampaignType | null;
  description_pt?: string;
  banner?: string | null;
  logo?: string | null;
  videos?: string[];
  ends_at?: string | null;
  donate_methods?: DonateMethodId[] | null;
  donate_frequencies?: TFrequency[] | null;
  increments?: IIncrement[] | null;
  target?: string | undefined;
  hide_bg_tip?: boolean;
  program_id?: string | null;
  program_name?: string | null;
}

const raised = sql`COALESCE(${v_campaign_total_usd.total}, 0)`.mapWith(
  v_campaign_total_usd.total
);

function campaign_query() {
  return db
    .select({
      campaign: campaigns,
      raised,
      owner_slug: npos.slug,
      owner_published: npos.published,
      owner_name: npos.name,
      owner_image: npos.image,
      owner_logo: npos.logo,
      creator_name: sql<string>`${user.first_name} || ' ' || ${user.last_name}`,
    })
    .from(campaigns)
    .innerJoin(npos, eq(npos.id, campaigns.owner_npo_id))
    .innerJoin(user, eq(user.id, campaigns.creator_id))
    .leftJoin(
      v_campaign_total_usd,
      eq(v_campaign_total_usd.campaign_id, campaigns.id)
    );
}

function present(
  row: Awaited<ReturnType<ReturnType<typeof campaign_query>["where"]>>[number]
) {
  const { target_number, target_smart, ...rest } = row.campaign;
  return {
    ...rest,
    target: to_target(target_number, target_smart),
    raised: row.raised ?? 0,
    owner_slug: row.owner_slug,
    owner_published: row.owner_published,
    owner_name: row.owner_name,
    owner_image: row.owner_image,
    owner_logo: row.owner_logo,
    creator_name: row.creator_name,
    hero: rest.banner ?? row.owner_image,
    mark: rest.logo ?? row.owner_logo,
  };
}

export type ICampaignRow = ReturnType<typeof present>;

/** admin list. a campaign folded from a multi-beneficiary fund is left out:
 * that fund keeps its own page and editor (see `folded_campaign_public`), so
 * it lists once, as its fund row */
export async function campaign_list(npo_id: number): Promise<ICampaignRow[]> {
  const rows = await campaign_query()
    .where(
      and(
        eq(campaigns.owner_npo_id, npo_id),
        sql`(${campaigns.legacy_fund_id} IS NULL OR (SELECT count(*) FROM ${fund_members} WHERE ${fund_members.fund_id} = ${campaigns.legacy_fund_id}) <= 1)`
      )
    )
    .orderBy(desc(campaigns.created_at));
  return rows.map(present);
}

export async function campaign_count(npo_id: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(campaigns)
    .where(eq(campaigns.owner_npo_id, npo_id));
  return row?.n ?? 0;
}

export async function campaign_get(
  npo_id: number,
  id: string
): Promise<ICampaignRow | undefined> {
  const [row] = await campaign_query().where(
    and(eq(campaigns.id, id), eq(campaigns.owner_npo_id, npo_id))
  );
  return row && present(row);
}

const PG_INT_MAX = 2_147_483_647;

/** public page: draft and unknown stay absent. ended and live both return.
 * an all-digit `org` is the owner's id (a slug is never all digits), any other
 * value its slug */
export async function campaign_public(
  org: string,
  campaign_slug: string
): Promise<ICampaignRow | undefined> {
  const owner_id = /^\d+$/.test(org) ? Number(org) : null;
  // past int4 the bound param would raise instead of matching nothing
  if (owner_id !== null && owner_id > PG_INT_MAX) return undefined;
  const [row] = await campaign_query().where(
    and(
      owner_id === null
        ? sql`LOWER(${npos.slug}) = LOWER(${org})`
        : eq(campaigns.owner_npo_id, owner_id),
      sql`LOWER(${campaigns.slug}) = LOWER(${campaign_slug})`,
      sql`${campaigns.status} <> 'draft'`
    )
  );
  return row && present(row);
}

/** `campaign_donor_counts` for one campaign */
export async function campaign_donor_count(
  campaign_id: string
): Promise<number> {
  const counts = await campaign_donor_counts([campaign_id]);
  return counts.get(campaign_id) ?? 0;
}

/** distinct donors with a settled gift, per campaign, by `npo_donor_count`'s
 * rule: settled per dist (a refund flips the dist, not the donation), email as
 * stored. messages are not donors. a campaign with no such gift maps to 0 */
export async function campaign_donor_counts(
  campaign_ids: string[]
): Promise<Map<string, number>> {
  const counts = new Map(campaign_ids.map((id) => [id, 0]));
  if (campaign_ids.length === 0) return counts;
  const rows = await db
    .select({
      campaign_id: donations.campaign_id,
      n: sql<number>`count(distinct ${donation_donors.email})::int`,
    })
    .from(donations)
    .innerJoin(dists, eq(dists.donation_id, donations.id))
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .where(
      and(
        inArray(donations.campaign_id, campaign_ids),
        eq(dists.status, "settled")
      )
    )
    .groupBy(donations.campaign_id);
  for (const r of rows) if (r.campaign_id) counts.set(r.campaign_id, r.n);
  return counts;
}

/** usd preview for a gift that can still settle: `amount_base / upusd`, and only while status is created, intent, or confirmed. a return can land before the row leaves created. tip and the donor-covered fee are not part of it. a blank id, a missing row, any other status, a rate that is not a positive finite number, or a base that is not positive is unknown. */
export async function campaign_donation_base_usd(
  campaign_id: string,
  donation_id: string
): Promise<number | null> {
  const id = donation_id.trim();
  if (id === "") return null;
  const [row] = await db
    .select({
      amount_base: donations.amount_base,
      upusd: donations.upusd,
    })
    .from(donations)
    .where(
      and(
        eq(donations.id, id),
        eq(donations.campaign_id, campaign_id),
        or(
          eq(donations.status, "created"),
          eq(donations.status, "intent"),
          eq(donations.status, "confirmed")
        )
      )
    )
    .limit(1);
  if (!row) return null;
  if (!Number.isFinite(row.upusd) || row.upusd <= 0) return null;
  if (!Number.isFinite(row.amount_base) || row.amount_base <= 0) return null;
  const usd = row.amount_base / row.upusd;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return usd;
}

/** this donation is settled on this campaign. a card return is base plus tip plus fee, and settlement writes a donor name only when from_public is set, so neither identifies the row. a blank id is unknown. */
export async function campaign_settled_donation(
  campaign_id: string,
  donation_id: string
): Promise<boolean> {
  const id = donation_id.trim();
  if (id === "") return false;
  const [row] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(
      and(
        eq(donations.id, id),
        eq(donations.campaign_id, campaign_id),
        eq(donations.status, "settled")
      )
    )
    .limit(1);
  return row != null;
}

/** another settled gift on this campaign shares this donation's donor email. names are not identity; a missing row or a blank email is unknown. */
export async function campaign_repeat_donor(
  campaign_id: string,
  donation_id: string
): Promise<boolean> {
  const id = donation_id.trim();
  if (id === "") return false;
  const [donor] = await db
    .select({ email: donation_donors.email })
    .from(donation_donors)
    .where(eq(donation_donors.donation_id, id))
    .limit(1);
  const email = donor?.email.trim() ?? "";
  if (email === "") return false;
  const [row] = await db
    .select({ id: donations.id })
    .from(donations)
    .innerJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    .where(
      and(
        eq(donations.campaign_id, campaign_id),
        eq(donations.status, "settled"),
        ne(donations.id, id),
        sql`lower(btrim(${donation_donors.email})) = lower(${email})`
      )
    )
    .limit(1);
  return row != null;
}

/** a stored live whose ends_at has passed is not live. */
const is_live = () =>
  and(
    eq(campaigns.status, "live"),
    or(isNull(campaigns.ends_at), sql`${campaigns.ends_at} > now()`)
  );

export async function campaign_live_for_npo(
  npo_id: number
): Promise<ICampaignRow[]> {
  const rows = await campaign_query()
    .where(and(eq(campaigns.owner_npo_id, npo_id), is_live()))
    .orderBy(desc(campaigns.created_at));
  return rows.map(present);
}

export async function campaign_live_for_program(
  program_id: string
): Promise<ICampaignRow[]> {
  const rows = await campaign_query()
    .where(and(eq(campaigns.program_id, program_id), is_live()))
    .orderBy(desc(campaigns.created_at));
  return rows.map(present);
}

export async function campaign_live_count(npo_id: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(campaigns)
    .where(and(eq(campaigns.owner_npo_id, npo_id), is_live()));
  return row?.n ?? 0;
}

export async function campaign_by_id(
  id: string
): Promise<ICampaignRow | undefined> {
  const [row] = await campaign_query().where(eq(campaigns.id, id));
  return row && present(row);
}

/** the campaign an org fund was folded into, if any, with its owner's slug for
 * the public url and the owner's publication state; the 301s off `/campaigns/*`
 * read this */
export interface IFoldedCampaign {
  id: string;
  slug: string;
  status: TCampaignStatus;
  owner_npo_id: number | null;
  owner_slug: string | null;
  /** owner npo publication state; the public campaign page 404s when the owner
   * is unpublished or inactive, so a 301 must check these first */
  owner_published: boolean | null;
  owner_active: boolean | null;
}

export async function campaign_by_legacy_fund(
  fund_id: string
): Promise<IFoldedCampaign | undefined> {
  const [row] = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      status: campaigns.status,
      owner_npo_id: campaigns.owner_npo_id,
      owner_slug: npos.slug,
      owner_published: npos.published,
      owner_active: npos.active,
    })
    .from(campaigns)
    .leftJoin(npos, eq(npos.id, campaigns.owner_npo_id))
    .where(eq(campaigns.legacy_fund_id, fund_id))
    .limit(1);
  return row;
}

/** stored `live` reads as ended once `ends_at` has passed. the row stays live. */
export function campaign_shown_status(
  row: { status: TCampaignStatus; ends_at: string | null },
  now: Date = new Date()
): TCampaignStatus {
  if (row.status === "live" && !campaign_accepts(row, now)) return "ended";
  return row.status;
}

export function campaign_accepts(
  row: { status: TCampaignStatus; ends_at: string | null },
  now: Date
): boolean {
  if (row.status !== "live") return false;
  if (row.ends_at && new Date(row.ends_at).getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

export async function campaign_slug_taken(
  npo_id: number,
  slug: string,
  except_id?: string
): Promise<boolean> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.owner_npo_id, npo_id),
        sql`LOWER(${campaigns.slug}) = LOWER(${slug})`
      )
    );
  return rows.some((r) => r.id !== except_id);
}

function columns_target(target: string | undefined) {
  if (!target || target === "0") {
    return { target_number: null, target_smart: null };
  }
  return from_target(target);
}

export async function campaign_create(input: ICampaignInput) {
  const target = columns_target(input.target);
  await db.transaction(async (tx) => {
    await tx.insert(campaigns).values({
      id: input.id,
      owner_npo_id: input.owner_npo_id,
      creator_id: input.creator_id,
      name: input.name,
      slug: input.slug,
      campaign_type: input.campaign_type,
      description_pt: input.description_pt,
      description_v2: to_text(input.description_pt),
      banner: input.banner,
      logo: input.logo,
      videos: input.videos,
      ends_at: input.ends_at,
      donate_methods: input.donate_methods,
      donate_frequencies: input.donate_frequencies,
      increments: input.increments,
      target_number: target.target_number,
      target_smart: target.target_smart,
      hide_bg_tip: input.hide_bg_tip,
      program_id: input.program_id,
      program_name: input.program_name,
    });
    await tx.insert(campaign_members).values({
      campaign_id: input.id,
      npo_id: input.owner_npo_id,
      position: 0,
    });
  });
}

/** the next `updated_at`: now, or a millisecond past the stored one when the
 * clock hasn't moved, so no two writes leave a campaign at the same version */
export const next_updated_at = () =>
  sql`GREATEST(${new Date().toISOString()}::timestamptz, ${campaigns.updated_at} + interval '1 millisecond')`;

/** `guard` joins the write's WHERE; a row it turns away is "refused" */
export async function campaign_update(
  npo_id: number,
  id: string,
  patch: ICampaignPatch,
  guard?: SQL
): Promise<"ok" | "missing" | "slug_locked" | "refused"> {
  const current = await campaign_get(npo_id, id);
  if (!current) return "missing";
  // the read above can sit before a concurrent publish. the write itself
  // refuses a new address once published_at is set.
  const slug_changes =
    patch.slug !== undefined &&
    patch.slug.toLowerCase() !== current.slug.toLowerCase();
  const target =
    patch.target !== undefined ? columns_target(patch.target) : undefined;
  const desc =
    patch.description_pt !== undefined
      ? {
          description_pt: patch.description_pt,
          description_v2: to_text(patch.description_pt),
        }
      : {};
  const rows = await db
    .update(campaigns)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.campaign_type !== undefined
        ? { campaign_type: patch.campaign_type }
        : {}),
      ...desc,
      ...(patch.banner !== undefined ? { banner: patch.banner } : {}),
      ...(patch.logo !== undefined ? { logo: patch.logo } : {}),
      ...(patch.videos !== undefined ? { videos: patch.videos } : {}),
      ...(patch.ends_at !== undefined ? { ends_at: patch.ends_at } : {}),
      ...(patch.donate_methods !== undefined
        ? { donate_methods: patch.donate_methods }
        : {}),
      ...(patch.donate_frequencies !== undefined
        ? { donate_frequencies: patch.donate_frequencies }
        : {}),
      ...(patch.increments !== undefined
        ? { increments: patch.increments }
        : {}),
      ...(target
        ? {
            target_number: target.target_number,
            target_smart: target.target_smart,
          }
        : {}),
      ...(patch.hide_bg_tip !== undefined
        ? { hide_bg_tip: patch.hide_bg_tip }
        : {}),
      ...(patch.program_id !== undefined
        ? { program_id: patch.program_id }
        : {}),
      ...(patch.program_name !== undefined
        ? { program_name: patch.program_name }
        : {}),
      updated_at: next_updated_at(),
    })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.owner_npo_id, npo_id),
        slug_changes ? sql`${campaigns.published_at} is null` : undefined,
        guard
      )
    )
    .returning({ id: campaigns.id });
  if (rows.length > 0) return "ok";
  const still = await campaign_get(npo_id, id);
  if (!still) return "missing";
  if (slug_changes && still.published_at) return "slug_locked";
  return guard ? "refused" : "missing";
}

/** false when the slug was locked and the caller tried to change it */
export async function campaign_slug_refused(
  npo_id: number,
  id: string,
  slug: string
): Promise<boolean> {
  const current = await campaign_get(npo_id, id);
  if (!current?.published_at) return false;
  return slug.toLowerCase() !== current.slug.toLowerCase();
}

export async function campaign_publish(
  npo_id: number,
  id: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await db
    .update(campaigns)
    .set({
      status: "live",
      published_at: sql`COALESCE(${campaigns.published_at}, ${now})`,
      updated_at: next_updated_at(),
    })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.owner_npo_id, npo_id),
        sql`${campaigns.status} <> 'ended'`
      )
    )
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

/** sets where gifts go and publishes, in one write that only a never-published,
 * not-ended campaign whose end date has not passed takes; false leaves the row as it was */
export async function campaign_first_publish(
  npo_id: number,
  id: string,
  program: { id: string; title: string } | null
): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await db
    .update(campaigns)
    .set({
      program_id: program?.id ?? null,
      program_name: program?.title ?? null,
      status: "live",
      published_at: now,
      updated_at: next_updated_at(),
    })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.owner_npo_id, npo_id),
        sql`${campaigns.status} <> 'ended'`,
        isNull(campaigns.published_at),
        // an end date already past would publish it closed: the bound `fund_is_open_sql` uses
        sql`(${campaigns.ends_at} IS NULL OR ${campaigns.ends_at} >= (date_trunc('day', (NOW() AT TIME ZONE 'UTC') - interval '12 hours') AT TIME ZONE 'UTC'))`
      )
    )
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

export async function campaign_end(
  npo_id: number,
  id: string
): Promise<boolean> {
  // an ended campaign is left as it is, its updated_at included
  const rows = await db
    .update(campaigns)
    .set({ status: "ended", updated_at: next_updated_at() })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.owner_npo_id, npo_id),
        sql`${campaigns.status} <> 'ended'`
      )
    )
    .returning({ id: campaigns.id });
  if (rows.length > 0) return true;
  return (await campaign_get(npo_id, id)) !== undefined;
}

export async function campaign_gift_count(
  id: string,
  conn: DbOrTx = db
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(donations)
    .where(eq(donations.campaign_id, id));
  return row?.n ?? 0;
}

/** false when another nonprofit owns it, it has gifts, it was folded from a
 * fund, or it is missing */
export async function campaign_delete(
  npo_id: number,
  id: string
): Promise<boolean> {
  const current = await campaign_get(npo_id, id);
  if (!current) return false;
  if ((await campaign_gift_count(id)) > 0) return false;
  // a folded campaign carries historic legacy gifts (settled dists keyed on its
  // legacy_fund_id) that campaign_gift_count never sees; deleting it would
  // orphan that revenue, so it is undeletable like one with its own gifts
  if (current.legacy_fund_id) return false;
  await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.owner_npo_id, npo_id)));
  return true;
}
