import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  all_method_ids,
  freqs_default,
} from "#/components/donation/common/constants";
import { to_text } from "#/components/rich-text/helpers";
import type { TCampaignStatus } from "@/campaign";
import { fund_closes_at } from "@/fundraiser/is-open";
import type { DonateMethodId, IIncrement, TFrequency } from "@/schemas";
import type { DbOrTx } from "../pg/queries/helpers";
import { campaigns } from "../pg/schema/campaign";
import { pg_text_to_iso } from "../pg/schema/columns";
import { donation_disputes } from "../pg/schema/dispute";
import { dists } from "../pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donation_tributes,
  donations,
} from "../pg/schema/donation";
import { forms } from "../pg/schema/form";
import { funds } from "../pg/schema/fund";
import { npo_media, npos } from "../pg/schema/npo";
import { subscriptions } from "../pg/schema/subscription";
import { block_catalog } from "./catalog";
import { encode_list_cursor, type ListCursor } from "./cursor";
import {
  json,
  read_cursor,
  read_limit,
  read_window,
  refuse,
  stray_params,
} from "./http";
import { absolute, type Money, usd, usd_amount, usd_minor } from "./money";
import { type FieldError, not_found } from "./problem";

const CAMPAIGNS_NEWEST = "campaigns.newest";
const FORMS_NEWEST = "forms.newest";
const GIFTS_NEWEST = "gifts.newest";
const DONORS_NEWEST = "donors.newest";
const RECURRING_NEWEST = "recurring_gifts.newest";

const HAND_DOMAIN = "@recorded.invalid";

type Page<T> = { data: T[]; next_cursor: string | null };

function page<T>(
  rows: T[],
  limit: number,
  order: string,
  key_of: (row: T) => { v: string; id: string }
): Page<T> {
  const more = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  const key = last ? key_of(last) : null;
  return {
    data,
    next_cursor: more && key ? encode_list_cursor(order, key.v, key.id) : null,
  };
}

function older(
  time: ReturnType<typeof sql>,
  id: ReturnType<typeof sql>,
  cursor: ListCursor | null
) {
  if (!cursor) return undefined;
  return sql`(${time}, ${id}) < (${cursor.v}::timestamptz, ${cursor.id})`;
}

export type CampaignStatus = "draft" | "published" | "ended";

/**
 * A stored `ended` row is ended, and a draft stays a draft. A live campaign
 * stays open until noon UTC the day after `ends_at`'s calendar date — the
 * fundraiser rule in `fund_closes_at`. The public campaign page closes at
 * the `ends_at` instant instead.
 */
export function campaign_status(
  status: TCampaignStatus,
  ends_at: string | null,
  now = Date.now()
): CampaignStatus {
  if (status === "ended") return "ended";
  if (status === "draft") return "draft";
  if (ends_at && now >= fund_closes_at(ends_at).getTime()) return "ended";
  return "published";
}

type Block =
  | { type: "title"; text: string }
  | { type: "story"; text: string }
  | { type: "hero"; image_url: string | null }
  | { type: "goal-bar"; goal: Money | null };

function campaign_url(
  npo_slug: string | null,
  slug: string,
  status: CampaignStatus
): string | null {
  if (status === "draft" || !npo_slug) return null;
  return absolute(`/org/${npo_slug}/${slug}`);
}

function end_date_of(ends_at: string | null): string | null {
  if (!ends_at) return null;
  return ends_at.slice(0, 10);
}

type CampaignRow = {
  id: string;
  name: string;
  slug: string;
  status: TCampaignStatus;
  ends_at: string | null;
  target_number: number | null;
  description_pt: string;
  banner: string | null;
  created_at: string;
  updated_at: string;
  npo_slug: string | null;
};

function summary_of(row: CampaignRow) {
  const status = campaign_status(row.status, row.ends_at);
  return {
    id: row.id,
    title: row.name,
    status,
    slug: row.slug,
    public_url: campaign_url(row.npo_slug, row.slug, status),
    goal: usd(row.target_number),
    end_date: end_date_of(row.ends_at),
    updated_at: row.updated_at,
  };
}

function detail_of(row: CampaignRow) {
  return {
    ...summary_of(row),
    has_unpublished_changes: false,
    sharing: { message: null, channels: null },
    time_zone: null,
    blocks: [
      { type: "title", text: row.name },
      { type: "story", text: to_text(row.description_pt) },
      { type: "hero", image_url: row.banner ? row.banner : null },
      { type: "goal-bar", goal: usd(row.target_number) },
    ] satisfies Block[],
  };
}

const campaign_cols = {
  id: campaigns.id,
  name: campaigns.name,
  slug: campaigns.slug,
  status: campaigns.status,
  ends_at: campaigns.ends_at,
  target_number: campaigns.target_number,
  description_pt: campaigns.description_pt,
  banner: campaigns.banner,
  created_at: campaigns.created_at,
  updated_at: campaigns.updated_at,
  npo_slug: npos.slug,
};

/** UTC date of now minus 12 hours. Same bound as `fund_is_open_sql`. */
function close_bound() {
  return sql`(date_trunc('day', (NOW() AT TIME ZONE 'UTC') - interval '12 hours') AT TIME ZONE 'UTC')`;
}

function ended_sql() {
  return sql`(
    ${campaigns.status} = 'ended'
    OR (
      ${campaigns.status} = 'live'
      AND ${campaigns.ends_at} IS NOT NULL
      AND ${campaigns.ends_at} < ${close_bound()}
    )
  )`;
}

function status_sql(status: CampaignStatus) {
  if (status === "ended") return ended_sql();
  if (status === "draft") return sql`${campaigns.status} = 'draft'`;
  return sql`${campaigns.status} = 'live' AND (
    ${campaigns.ends_at} IS NULL OR ${campaigns.ends_at} >= ${close_bound()}
  )`;
}

export async function list_campaigns(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["status", "cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, CAMPAIGNS_NEWEST, issues);
  const status = url.searchParams.get("status");
  if (
    status !== null &&
    status !== "draft" &&
    status !== "published" &&
    status !== "ended"
  ) {
    issues.push({
      path: "status",
      message: "is draft, published, or ended",
    });
  }
  const refused = refuse(issues);
  if (refused) return refused;

  const rows = await db
    .select(campaign_cols)
    .from(campaigns)
    .innerJoin(npos, eq(npos.id, campaigns.owner_npo_id))
    .where(
      and(
        eq(campaigns.owner_npo_id, npo_id),
        status ? status_sql(status as CampaignStatus) : undefined,
        older(sql`${campaigns.created_at}`, sql`${campaigns.id}`, cursor)
      )
    )
    .orderBy(desc(campaigns.created_at), desc(campaigns.id))
    .limit(limit + 1);

  const listed = page(rows, limit, CAMPAIGNS_NEWEST, (row) => ({
    v: row.created_at,
    id: row.id,
  }));
  return json({
    data: listed.data.map(summary_of),
    next_cursor: listed.next_cursor,
  });
}

export async function read_campaign_detail(
  db: DbOrTx,
  npo_id: number,
  id: string
) {
  const [row] = await db
    .select(campaign_cols)
    .from(campaigns)
    .innerJoin(npos, eq(npos.id, campaigns.owner_npo_id))
    .where(and(eq(campaigns.id, id), eq(campaigns.owner_npo_id, npo_id)));
  return row ? detail_of(row) : null;
}

export async function get_campaign(
  db: DbOrTx,
  npo_id: number,
  id: string,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, [], issues);
  const refused = refuse(issues);
  if (refused) return refused;
  const detail = await read_campaign_detail(db, npo_id, id);
  if (!detail)
    return not_found(`Campaign ${id} does not exist for this nonprofit.`);
  return json(detail);
}

export async function get_donation_page(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, [], issues);
  const refused = refuse(issues);
  if (refused) return refused;

  const [npo] = await db
    .select({
      id: npos.id,
      name: npos.name,
      slug: npos.slug,
      published: npos.published,
      active: npos.active,
      overview_v2: npos.overview_v2,
      overview_pt: npos.overview_pt,
      logo: npos.logo,
      image: npos.image,
      updated_at: npos.updated_at,
    })
    .from(npos)
    .where(eq(npos.id, npo_id));
  if (!npo) return not_found("This nonprofit does not exist.");

  const [album] = await db
    .select({ url: npo_media.url })
    .from(npo_media)
    .where(and(eq(npo_media.npo_id, npo_id), eq(npo_media.type, "album")))
    .orderBy(desc(npo_media.featured), asc(npo_media.id))
    .limit(1);

  const status: CampaignStatus =
    npo.published && npo.active ? "published" : "draft";
  const public_id = npo.slug || String(npo.id);
  const hero = npo.logo || npo.image || album?.url || null;
  return json({
    status,
    public_url: status === "published" ? absolute(`/org/${public_id}`) : null,
    has_unpublished_changes: false,
    sharing: { message: null, channels: null },
    blocks: [
      { type: "title", text: npo.name },
      { type: "story", text: npo.overview_v2 || npo.overview_pt },
      { type: "hero", image_url: hero },
    ],
    updated_at: npo.updated_at,
  });
}

export function get_block_catalog(url: URL): Response {
  const issues: FieldError[] = [];
  stray_params(url, [], issues);
  const refused = refuse(issues);
  if (refused) return refused;
  return json(block_catalog());
}

const EPOCH = "1970-01-01T00:00:00.000Z";

function form_stamp() {
  return sql`COALESCE(${forms.date_created}, ${EPOCH}::timestamptz)`;
}

type FormRow = {
  id: string;
  name: string;
  tag: string | null;
  status: string | null;
  increments: IIncrement[] | null;
  freq_opts: TFrequency[] | null;
  donate_methods: DonateMethodId[] | null;
  program_id: string | null;
  recipient_fund_id: string | null;
  fund_owner: number | null;
  date_created: string | null;
  stamped: string;
};

function form_of(row: FormRow, npo_id: number) {
  const amounts = row.increments ?? [];
  const suggested_amounts = amounts.flatMap((item) => {
    const n = Number(item.value);
    if (!Number.isFinite(n)) return [];
    return [usd(n) as Money];
  });
  const owned_here =
    row.recipient_fund_id !== null && row.fund_owner === npo_id;
  return {
    id: row.id,
    // the form's label; `name` is the recipient donors see. the admin list's
    // fallback, so an unlabelled form reads as it does there
    name: row.tag || row.name,
    status: row.status === "active" ? "live" : "draft",
    suggested_amounts,
    // unset (and, for frequencies, empty) is what the donate form defaults
    frequencies: row.freq_opts?.length ? row.freq_opts : freqs_default,
    donate_methods: row.donate_methods ?? all_method_ids,
    minimum: null,
    maximum: null,
    allowed_origins: [] as string[],
    gifts_go_to: row.program_id
      ? { mode: "pinned" as const, program_id: row.program_id }
      : { mode: "none" as const, program_id: null },
    campaign_id: owned_here ? row.recipient_fund_id : null,
    updated_at: row.date_created ? pg_text_to_iso(row.date_created) : EPOCH,
  };
}

function forms_for(npo_id: number) {
  return eq(forms.owner_npo_id, npo_id);
}

const form_cols = {
  id: forms.id,
  name: forms.name,
  tag: forms.tag,
  status: forms.status,
  increments: forms.increments,
  freq_opts: forms.freq_opts,
  donate_methods: forms.donate_methods,
  program_id: forms.program_id,
  recipient_fund_id: forms.recipient_fund_id,
  fund_owner: funds.npo_owner,
  date_created: forms.date_created,
  stamped:
    sql<string>`COALESCE(${forms.date_created}, ${EPOCH}::timestamptz)`.as(
      "stamped"
    ),
};

export async function list_forms(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, FORMS_NEWEST, issues);
  const refused = refuse(issues);
  if (refused) return refused;

  const rows = await db
    .select(form_cols)
    .from(forms)
    .leftJoin(funds, eq(forms.recipient_fund_id, funds.id))
    .where(
      and(forms_for(npo_id), older(form_stamp(), sql`${forms.id}`, cursor))
    )
    .orderBy(desc(form_stamp()), desc(forms.id))
    .limit(limit + 1);

  const listed = page(rows, limit, FORMS_NEWEST, (row) => ({
    v: pg_text_to_iso(String(row.stamped)),
    id: row.id,
  }));
  return json({
    data: listed.data.map((row) => form_of(normalize_form(row), npo_id)),
    next_cursor: listed.next_cursor,
  });
}

function normalize_form(row: FormRow): FormRow {
  return {
    ...row,
    date_created: row.date_created ? pg_text_to_iso(row.date_created) : null,
    stamped: pg_text_to_iso(String(row.stamped)),
  };
}

export async function get_form(
  db: DbOrTx,
  npo_id: number,
  id: string,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, [], issues);
  const refused = refuse(issues);
  if (refused) return refused;
  const form = await read_form(db, npo_id, id);
  if (!form) return not_found(`Form ${id} does not exist for this nonprofit.`);
  return json(form);
}

export type ConnectorForm = ReturnType<typeof form_of>;

/** the get_form shape of a form this nonprofit owns, or null */
export async function read_form(
  db: DbOrTx,
  npo_id: number,
  id: string
): Promise<ConnectorForm | null> {
  const [row] = await db
    .select(form_cols)
    .from(forms)
    .leftJoin(funds, eq(forms.recipient_fund_id, funds.id))
    .where(and(eq(forms.id, id), forms_for(npo_id)));
  return row ? form_of(normalize_form(row), npo_id) : null;
}

function tenant_gifts(npo_id: number) {
  // A dist to this nonprofit can exist with no recipient row. A gift can also
  // name this nonprofit only as a recipient. A required recipient join misses the first.
  return sql`(
    exists (
      select 1 from ${dists}
      where ${dists.donation_id} = ${donations.id}
        and ${dists.to_id} = ${npo_id}
    )
    OR ${donation_recipients.npo_id} = ${npo_id}
    OR ${donation_recipients.fund_id} IN (
      SELECT ${funds.id} FROM ${funds} WHERE ${funds.npo_owner} = ${npo_id}
    )
  )`;
}

function settled_usd(npo_id: number) {
  // A dist for this nonprofit counts only while it is settled. A refunded dist
  // is 0: process_refund can leave the donation settled while this share is
  // already returned. amount_base / upusd is only for a gift with no dist.
  return sql`case
    when exists (
      select 1 from ${dists}
      where ${dists.donation_id} = ${donations.id}
        and ${dists.to_id} = ${npo_id}
    )
    then coalesce((
      select sum(${dists.net})
      from ${dists}
      where ${dists.donation_id} = ${donations.id}
        and ${dists.to_id} = ${npo_id}
        and ${dists.status} = 'settled'
    ), 0)
    else ${donations.amount_base} / nullif(${donations.upusd}, 0)
  end`;
}

async function require_own_campaign(
  db: DbOrTx,
  npo_id: number,
  id: string
): Promise<Response | null> {
  const [row] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.owner_npo_id, npo_id)));
  if (!row)
    return not_found(`Campaign ${id} does not exist for this nonprofit.`);
  return null;
}

type GiftStatus = "settled" | "partially_refunded" | "refunded";
type PayMethod =
  | "cash"
  | "check"
  | "card"
  | "ach"
  | "paypal"
  | "venmo"
  | "daf"
  | "crypto";
type GiftFrequency = "one_time" | "monthly" | "yearly";

export function payment_method(via: string): PayMethod {
  if (via === "cash") return "cash";
  if (via === "check" || via === "cheque") return "check";
  if (via.startsWith("crypto")) return "crypto";
  if (via === "daf" || via.startsWith("chariot")) return "daf";
  if (via === "venmo" || via.includes("venmo")) return "venmo";
  if (via.startsWith("paypal")) return "paypal";
  if (via.includes("ach") || via.includes("us_bank") || via.includes("bank"))
    return "ach";
  return "card";
}

export function gift_frequency(frequency: string): {
  recurring: boolean;
  frequency: GiftFrequency;
} {
  if (frequency === "annual" || frequency === "yearly" || frequency === "year")
    return { recurring: true, frequency: "yearly" };
  if (
    frequency === "monthly" ||
    frequency === "month" ||
    frequency === "weekly" ||
    frequency === "week"
  )
    return { recurring: true, frequency: "monthly" };
  return { recurring: false, frequency: "one_time" };
}

function standing(
  status: string,
  share: number | null,
  amount_minor: number
): { status: GiftStatus; amount_refunded_minor: number } {
  if (status === "refunded" || status === "refunded_loss") {
    return { status: "refunded", amount_refunded_minor: amount_minor };
  }
  if (share && share > 0) {
    const refunded = Math.min(amount_minor, Math.round(share * amount_minor));
    return {
      status: refunded >= amount_minor ? "refunded" : "partially_refunded",
      amount_refunded_minor: refunded,
    };
  }
  return { status: "settled", amount_refunded_minor: 0 };
}

export function donor_wire(email: string): {
  id: string;
  email: string | null;
} {
  if (email.startsWith("hand-") && email.endsWith(HAND_DOMAIN)) {
    return { id: email.slice(0, -HAND_DOMAIN.length), email: null };
  }
  const lower = email.toLowerCase();
  return { id: lower, email: lower };
}

function donor_match(id: string) {
  if (id.startsWith("hand-") && !id.includes("@")) {
    return eq(donation_donors.email, `${id}${HAND_DOMAIN}`);
  }
  return sql`lower(${donation_donors.email}) = ${id.toLowerCase()}`;
}

const gift_cols = {
  id: donations.id,
  upusd: donations.upusd,
  amount_base: donations.amount_base,
  currency: donations.currency,
  fee: donations.amount_fee_allowance,
  frequency: donations.frequency,
  via: donations.via,
  source: donations.source,
  form_id: donations.form_id,
  form_name: forms.name,
  program_name: donations.program_name,
  tribute: donation_tributes.name,
  refunded_share: donations.refunded_share,
  status: donations.status,
  donor_email: donation_donors.email,
  donor_name: donation_donors.name,
  campaign_id: donations.campaign_id,
  campaign_owner: campaigns.owner_npo_id,
  created_at: donations.created_at,
  updated_at: donations.updated_at,
  dispute_open: sql<boolean>`exists (
    select 1 from ${donation_disputes}
    where ${donation_disputes.donation_id} = ${donations.id}
      and ${donation_disputes.status} = 'open'
  )`.as("dispute_open"),
};

type GiftRow = {
  id: string;
  upusd: number;
  amount_base: number;
  currency: string;
  fee: number;
  frequency: string;
  via: string;
  source: string;
  form_id: string | null;
  form_name: string | null;
  program_name: string | null;
  tribute: string | null;
  refunded_share: number | null;
  status: string;
  donor_email: string;
  donor_name: string | null;
  campaign_id: string | null;
  campaign_owner: number | null;
  created_at: string;
  updated_at: string;
  dispute_open: boolean;
};

function gift_of(row: GiftRow, npo_id: number) {
  const usd_gift = row.currency === "USD";
  const major = row.amount_base;
  const amount_minor = usd_minor(major);
  const freq = gift_frequency(row.frequency);
  const who = donor_wire(row.donor_email);
  const stand = standing(row.status, row.refunded_share, amount_minor);
  const campaign_id =
    row.campaign_id && row.campaign_owner === npo_id ? row.campaign_id : null;
  return {
    id: row.id,
    donation_id: row.id,
    occurred_at: row.created_at,
    amount: usd_gift ? usd_amount(major) : String(major),
    amount_minor,
    currency: usd_gift ? "USD" : row.currency,
    covered_fee_minor: usd_minor(row.fee),
    method: payment_method(row.via),
    recurring: freq.recurring,
    frequency: freq.frequency,
    form_id: row.form_id,
    form_name: row.form_name,
    program_name: row.program_name,
    dedication_kind: null,
    dedication_honoree: row.tribute,
    donor_id: who.id,
    donor_name: row.donor_name ?? "",
    donor_email: who.email,
    coin: null,
    coin_amount: null,
    status: stand.status,
    amount_refunded_minor: stand.amount_refunded_minor,
    dispute_open: Boolean(row.dispute_open),
    updated_at: row.updated_at,
    campaign_id,
  };
}

function gift_query(db: DbOrTx) {
  return db
    .select(gift_cols)
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .leftJoin(forms, eq(forms.id, donations.form_id))
    .leftJoin(
      donation_tributes,
      eq(donation_tributes.donation_id, donations.id)
    )
    .leftJoin(campaigns, eq(campaigns.id, donations.campaign_id));
}

export async function list_donations(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["campaign_id", "from", "to", "cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, GIFTS_NEWEST, issues);
  const window = read_window(url, issues);
  const campaign_id = url.searchParams.get("campaign_id");
  if (campaign_id === "") {
    issues.push({
      path: "campaign_id",
      message: "is a campaign id, or left out",
    });
  }
  const refused = refuse(issues);
  if (refused) return refused;
  if (campaign_id) {
    const missing = await require_own_campaign(db, npo_id, campaign_id);
    if (missing) return missing;
  }

  const rows = await gift_query(db)
    .where(
      and(
        eq(donations.status, "settled"),
        tenant_gifts(npo_id),
        campaign_id ? eq(donations.campaign_id, campaign_id) : undefined,
        window.start ? gte(donations.created_at, window.start) : undefined,
        window.end ? lt(donations.created_at, window.end) : undefined,
        older(sql`${donations.created_at}`, sql`${donations.id}`, cursor)
      )
    )
    .orderBy(desc(donations.created_at), desc(donations.id))
    .limit(limit + 1);

  const listed = page(rows, limit, GIFTS_NEWEST, (row) => ({
    v: row.created_at,
    id: row.id,
  }));
  return json({
    data: listed.data.map((row) => gift_of(row, npo_id)),
    next_cursor: listed.next_cursor,
  });
}

const donor_key = sql`CASE
  WHEN ${donation_donors.email} LIKE 'hand-%@recorded.invalid'
  THEN split_part(${donation_donors.email}, '@', 1)
  ELSE lower(${donation_donors.email})
END`;

function donor_q(q: string) {
  const needle = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  return sql`(
    ${donation_donors.name} ILIKE ${needle}
    OR (
      ${donation_donors.email} NOT LIKE 'hand-%@recorded.invalid'
      AND ${donation_donors.email} ILIKE ${needle}
    )
  )`;
}

type DonorRow = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  gift_count: number;
  total: string;
};

function donor_of(row: DonorRow) {
  const created = pg_text_to_iso(String(row.created_at));
  return {
    id: row.id,
    name: row.name ?? "",
    email: row.email,
    consent: "unasked" as const,
    created_at: created,
    updated_at: pg_text_to_iso(String(row.updated_at)),
    gift_count: Number(row.gift_count),
    total_given: usd(Number(row.total)) ?? {
      amount: "0.00",
      currency: "USD" as const,
    },
    cursor_v: created,
  };
}

function donor_base(npo_id: number) {
  return and(eq(donations.status, "settled"), tenant_gifts(npo_id));
}

async function donor_ids_matching(db: DbOrTx, npo_id: number, q: string) {
  const hits = await db
    .select({ id: sql<string>`${donor_key}`.as("donor_id") })
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .where(and(donor_base(npo_id), donor_q(q)))
    .groupBy(sql`${donor_key}`);
  return hits.map((hit) => hit.id);
}

export async function list_donors(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["q", "cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, DONORS_NEWEST, issues);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 200) {
    issues.push({ path: "q", message: "is at most 200 characters" });
  }
  const refused = refuse(issues);
  if (refused) return refused;

  const having = cursor
    ? sql`(min(${donations.created_at}), ${donor_key}) < (${cursor.v}::timestamptz, ${cursor.id})`
    : undefined;
  const matched = q ? await donor_ids_matching(db, npo_id, q) : null;
  if (matched && matched.length === 0) {
    return json({ data: [], next_cursor: null });
  }

  const rows = await db
    .select({
      id: sql<string>`${donor_key}`.as("donor_id"),
      name: sql<
        string | null
      >`(array_agg(${donation_donors.name} ORDER BY ${donations.created_at} DESC))[1]`,
      email: sql<string | null>`CASE
        WHEN bool_and(${donation_donors.email} LIKE 'hand-%@recorded.invalid') THEN NULL
        ELSE max(lower(${donation_donors.email})) FILTER (
          WHERE ${donation_donors.email} NOT LIKE 'hand-%@recorded.invalid'
        )
      END`,
      created_at: sql<string>`min(${donations.created_at})`,
      updated_at: sql<string>`max(${donations.updated_at})`,
      gift_count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${settled_usd(npo_id)}), 0)::text`,
    })
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .where(
      and(
        donor_base(npo_id),
        matched
          ? sql`${donor_key} IN (${sql.join(
              matched.map((id) => sql`${id}`),
              sql`, `
            )})`
          : undefined
      )
    )
    .groupBy(sql`${donor_key}`)
    .having(having ?? sql`true`)
    .orderBy(desc(sql`min(${donations.created_at})`), desc(sql`${donor_key}`))
    .limit(limit + 1);

  const listed = page(rows, limit, DONORS_NEWEST, (row) => ({
    v: pg_text_to_iso(String(row.created_at)),
    id: row.id,
  }));
  return json({
    data: listed.data.map((row) => {
      const donor = donor_of(row);
      const { cursor_v: _cursor, ...rest } = donor;
      return rest;
    }),
    next_cursor: listed.next_cursor,
  });
}

export async function get_donor(
  db: DbOrTx,
  npo_id: number,
  id: string,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, GIFTS_NEWEST, issues);
  const refused = refuse(issues);
  if (refused) return refused;

  const [found] = await db
    .select({
      id: sql<string>`${donor_key}`.as("donor_id"),
      name: sql<
        string | null
      >`(array_agg(${donation_donors.name} ORDER BY ${donations.created_at} DESC))[1]`,
      email: sql<string | null>`CASE
        WHEN bool_and(${donation_donors.email} LIKE 'hand-%@recorded.invalid') THEN NULL
        ELSE max(lower(${donation_donors.email})) FILTER (
          WHERE ${donation_donors.email} NOT LIKE 'hand-%@recorded.invalid'
        )
      END`,
      created_at: sql<string>`min(${donations.created_at})`,
      updated_at: sql<string>`max(${donations.updated_at})`,
      gift_count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${settled_usd(npo_id)}), 0)::text`,
    })
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .where(and(donor_base(npo_id), donor_match(id)))
    .groupBy(sql`${donor_key}`);

  if (!found)
    return not_found(`Donor ${id} does not exist for this nonprofit.`);

  const gifts = await gift_query(db)
    .where(
      and(
        eq(donations.status, "settled"),
        tenant_gifts(npo_id),
        donor_match(id),
        older(sql`${donations.created_at}`, sql`${donations.id}`, cursor)
      )
    )
    .orderBy(desc(donations.created_at), desc(donations.id))
    .limit(limit + 1);
  const listed = page(gifts, limit, GIFTS_NEWEST, (row) => ({
    v: row.created_at,
    id: row.id,
  }));
  const donor = donor_of(found);
  const { cursor_v: _cursor, ...rest } = donor;
  return json({
    ...rest,
    gifts: {
      data: listed.data.map((row) => gift_of(row, npo_id)),
      next_cursor: listed.next_cursor,
    },
  });
}

function recurring_frequency(interval: string): "monthly" | "yearly" {
  return interval === "year" ? "yearly" : "monthly";
}

export async function list_recurring(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["cursor", "limit"], issues);
  const limit = read_limit(url, issues);
  const cursor = read_cursor(url, RECURRING_NEWEST, issues);
  const refused = refuse(issues);
  if (refused) return refused;

  const rows = await db
    .select({
      id: subscriptions.id,
      from_id: subscriptions.from_id,
      amount_usd: subscriptions.amount_usd,
      interval: subscriptions.interval,
      status: subscriptions.status,
      next_billing: subscriptions.next_billing,
      created_at: subscriptions.created_at,
      updated_at: subscriptions.updated_at,
    })
    .from(subscriptions)
    .where(
      and(
        sql`(
          ${subscriptions.to_npo_id} = ${npo_id}
          OR ${subscriptions.to_fund_id} IN (
            SELECT ${funds.id} FROM ${funds} WHERE ${funds.npo_owner} = ${npo_id}
          )
        )`,
        older(
          sql`${subscriptions.created_at}`,
          sql`${subscriptions.id}`,
          cursor
        )
      )
    )
    .orderBy(desc(subscriptions.created_at), desc(subscriptions.id))
    .limit(limit + 1);

  const listed = page(rows, limit, RECURRING_NEWEST, (row) => ({
    v: row.created_at,
    id: row.id,
  }));
  return json({
    data: listed.data.map((row) => {
      const active = row.status === "active";
      return {
        id: row.id,
        donor_id: row.from_id.toLowerCase(),
        amount: usd_amount(row.amount_usd),
        amount_minor: usd_minor(row.amount_usd),
        currency: "USD",
        frequency: recurring_frequency(row.interval),
        status: active ? "active" : "stopped",
        next_charge_at: active ? row.next_billing : null,
        started_at: row.created_at,
        updated_at: row.updated_at,
      };
    }),
    next_cursor: listed.next_cursor,
  });
}

export async function get_results(
  db: DbOrTx,
  npo_id: number,
  url: URL
): Promise<Response> {
  const issues: FieldError[] = [];
  stray_params(url, ["campaign_id", "from", "to"], issues);
  const window = read_window(url, issues);
  const campaign_id = url.searchParams.get("campaign_id");
  if (campaign_id === "") {
    issues.push({
      path: "campaign_id",
      message: "is a campaign id, or left out",
    });
  }
  const refused = refuse(issues);
  if (refused) return refused;
  if (campaign_id) {
    const missing = await require_own_campaign(db, npo_id, campaign_id);
    if (missing) return missing;
  }

  const scope = and(
    eq(donations.status, "settled"),
    tenant_gifts(npo_id),
    campaign_id ? eq(donations.campaign_id, campaign_id) : undefined,
    window.start ? gte(donations.created_at, window.start) : undefined,
    window.end ? lt(donations.created_at, window.end) : undefined
  );

  const [totals] = await db
    .select({
      total: sql<string>`coalesce(sum(${settled_usd(npo_id)}), 0)::text`,
      gift_count: sql<number>`count(*)::int`,
      donor_count: sql<number>`count(DISTINCT CASE
        WHEN ${donation_donors.email} LIKE 'hand-%@recorded.invalid'
        THEN split_part(${donation_donors.email}, '@', 1)
        ELSE lower(${donation_donors.email})
      END)::int`,
    })
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
    .where(scope);

  const by_campaign = await db
    .select({
      campaign_id: donations.campaign_id,
      total: sql<string>`coalesce(sum(${settled_usd(npo_id)}), 0)::text`,
      gift_count: sql<number>`count(*)::int`,
    })
    .from(donations)
    .leftJoin(
      donation_recipients,
      eq(donation_recipients.donation_id, donations.id)
    )
    .where(and(scope, sql`${donations.campaign_id} IS NOT NULL`))
    .groupBy(donations.campaign_id);

  const raised = new Map(
    by_campaign.flatMap((row) =>
      row.campaign_id
        ? [
            [
              row.campaign_id,
              { total: Number(row.total), gift_count: Number(row.gift_count) },
            ] as const,
          ]
        : []
    )
  );

  const own_campaigns = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      target_number: campaigns.target_number,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.owner_npo_id, npo_id),
        campaign_id ? eq(campaigns.id, campaign_id) : undefined
      )
    )
    .orderBy(desc(campaigns.created_at), desc(campaigns.id));

  return json({
    total: usd(Number(totals?.total ?? 0)) ?? {
      amount: "0.00",
      currency: "USD" as const,
    },
    gift_count: Number(totals?.gift_count ?? 0),
    donor_count: Number(totals?.donor_count ?? 0),
    campaigns: own_campaigns.map((row) => {
      const hit = raised.get(row.id);
      return {
        id: row.id,
        title: row.name,
        total: usd(hit?.total ?? 0) ?? {
          amount: "0.00",
          currency: "USD" as const,
        },
        gift_count: hit?.gift_count ?? 0,
        goal: usd(row.target_number),
      };
    }),
  });
}
