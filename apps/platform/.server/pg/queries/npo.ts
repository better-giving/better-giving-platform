import {
  and,
  asc,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { INposPage, INpoWithRegNum } from "@/npo/interfaces";
import type { INposSearchObj } from "@/npo/schema";
import type { IBalanceDeltas } from "@/types/donation";
import { db } from "../db";
import { finite } from "../schema/columns";
import { npos } from "../schema/npo";
import { user_npo_memberships } from "../schema/user";
import { v_contributions } from "../schema/views";
import { to_target } from "./fmt";
import type { DbOrTx } from "./helpers";

export { npo_donor_count } from "./donor";

type NpoRow = typeof npos.$inferSelect;
type NpoInsert = typeof npos.$inferInsert;

const npo_cols = getTableColumns(npos);

// npo row with target XOR columns converted + contributions from v_contributions JOIN
export type INpo = Omit<NpoRow, "target_number" | "target_smart"> & {
  target: "smart" | string | undefined;
  contributions_total: number;
  contributions_count: number;
};

// what an unauthenticated, CDN-cached page may see. an allow-list: a new npos
// column is private until it is added here. balances, payout and referral
// bookkeeping, the stored tax-form id and the donation split stay off it.
export const NPO_PUBLIC_KEYS = [
  "id",
  "slug",
  "keyword",
  "registration_number",
  "name",
  "endow_designation",
  "overview_v2",
  "overview_pt",
  "tagline",
  "image",
  "logo",
  "card_img",
  "hq_country",
  "active_in_countries",
  "social_media_urls",
  "url",
  "sdgs",
  "receipt_msg",
  "hide_bg_tip",
  "published",
  "active",
  "prog_donations_allowed",
  "donate_methods",
  "donate_frequencies",
  "increments",
  "fund_opt_in",
  "kyc_donors_only",
  "fiscal_sponsored",
  "street_address",
  "donor_address_required",
  "created_at",
  "updated_at",
  "target",
  "contributions_total",
  "contributions_count",
] as const satisfies readonly (keyof INpo)[];

export type INpoPublic = Pick<INpo, (typeof NPO_PUBLIC_KEYS)[number]>;

export function npo_public(npo: INpo): INpoPublic {
  return Object.fromEntries(
    NPO_PUBLIC_KEYS.map((k) => [k, npo[k]])
  ) as INpoPublic;
}

type JoinedRow = Awaited<ReturnType<typeof joined_select>>[number];

// sql<T> alone skips the columns' decoders, and numeric and int8 arrive as text
const contributions = {
  contributions_total: sql`COALESCE(${v_contributions.total}, 0)`.mapWith(
    v_contributions.total
  ),
  contributions_count: sql`COALESCE(${v_contributions.count}, 0)`.mapWith(
    v_contributions.count
  ),
};

function joined_select(conn: DbOrTx = db) {
  return conn
    .select({ ...npo_cols, ...contributions })
    .from(npos)
    .leftJoin(v_contributions, eq(v_contributions.npo_id, npos.id));
}

function row_to_npo(row: JoinedRow): INpo {
  const { target_number, target_smart, ...rest } = row;
  return { ...rest, target: to_target(target_number, target_smart) };
}

export async function npo_get(
  id: number,
  conn?: DbOrTx
): Promise<INpo | undefined> {
  const [row] = await joined_select(conn).where(eq(npos.id, id));
  if (!row) return undefined;
  return row_to_npo(row);
}

/** the readiness mirror a newly connected account starts from */
export type TNpoStripeMirrorReset = Required<
  Pick<
    NpoInsert,
    | "stripe_charges_enabled"
    | "stripe_payouts_enabled"
    | "stripe_details_submitted"
    | "stripe_requirements_due"
    | "stripe_synced_at"
  >
>;

/**
 * connect `acct` to the npo, only while it still holds `held` (the account the
 * caller read, null for none), so a concurrent connect is not replaced
 * unconfirmed. clears a disconnect, which re-enables routing. true when written
 */
export async function npo_stripe_connect(
  tx: DbOrTx,
  npo_id: number,
  acct: string,
  held: string | null,
  mirror: TNpoStripeMirrorReset
): Promise<boolean> {
  const written = await tx
    .update(npos)
    .set({
      stripe_account_id: acct,
      stripe_connected_at: sql`now()`,
      stripe_deauthorized_at: null,
      ...mirror,
    })
    .where(
      and(
        eq(npos.id, npo_id),
        held === null
          ? isNull(npos.stripe_account_id)
          : eq(npos.stripe_account_id, held)
      )
    )
    .returning({ id: npos.id });
  return written.length > 0;
}

/** what a disconnect event did. `stale` when the npo holding `acct` connected
 * it after the event was created: a redelivery of an earlier disconnect.
 * `tied` when the connect and the event fall in the same second — `at` is
 * whole seconds and `stripe_connected_at` is not — so which came first is
 * not in the timestamps */
export type TNpoStripeDeauthorize =
  | { status: "marked"; npo_id: number }
  | { status: "stale"; npo_id: number }
  | { status: "tied"; npo_id: number }
  | { status: "unknown" };

/** how a same-second connect and disconnect are told apart. `ask` reports
 * `tied` and writes nothing. `mark` takes the disconnect as the later one.
 * `stale` takes the connect as the later one */
export type TStripeDeauthorizeTie = "ask" | "mark" | "stale";

/** mark the npo holding `acct` as disconnected from it at `at`, the event's
 * stripe-clock creation time. the earliest stamp since the last connect stays,
 * so a redelivered or out-of-order event never moves it later. a connect in
 * a later second wins; one in the event's own second is `tie` */
export async function npo_stripe_deauthorize(
  acct: string,
  at: string,
  conn: DbOrTx = db,
  tie: TStripeDeauthorizeTie = "ask"
): Promise<TNpoStripeDeauthorize> {
  // compared in the update itself: a connect committing first is re-read
  // under read committed, so the event can't stamp the account it reconnected.
  // `at` is the event's second. a connect later in that second is not older
  // than the event — `stripe_connected_at` carries the fraction `now()` has
  // and the event does not — so it is a tie unless `tie` has resolved it
  const older = sql`${npos.stripe_connected_at} is null or ${npos.stripe_connected_at} < ${at}::timestamptz`;
  const same_second = sql`${npos.stripe_connected_at} is not null and date_trunc('second', ${npos.stripe_connected_at}) = date_trunc('second', ${at}::timestamptz) and not (${older})`;
  const fresh = sql<boolean>`(${older} or (${tie === "mark"} and ${same_second}))`;
  const tied = sql<boolean>`(${tie === "ask"} and ${same_second})`;
  const [row] = await conn
    .update(npos)
    .set({
      // least() skips a null, so the first mark lands as `at`
      stripe_deauthorized_at: sql`case when ${fresh} then least(${npos.stripe_deauthorized_at}, ${at}::timestamptz) else ${npos.stripe_deauthorized_at} end`,
    })
    .where(eq(npos.stripe_account_id, acct))
    .returning({ id: npos.id, fresh, tied });
  if (!row) return { status: "unknown" };
  if (row.fresh) return { status: "marked", npo_id: row.id };
  if (row.tied) return { status: "tied", npo_id: row.id };
  return { status: "stale", npo_id: row.id };
}

/**
 * `npo_get` holding the npo row until `tx` ends: a balance check made on it
 * stays true for the write, and a concurrent withdrawal waits its turn.
 * lock order: `dists_locked` in `.server/refund/share.ts`
 */
export async function npo_get_locked(
  tx: DbOrTx,
  id: number
): Promise<INpo | undefined> {
  const [row] = await joined_select(tx)
    .where(eq(npos.id, id))
    // bare FOR also targets the left-joined view, which pg rejects. no key
    // update: balance writers still queue on it, but an insert whose FK
    // references this npo (a payout, a bal_tx) takes key share and doesn't
    .for("no key update", { of: npos });
  if (!row) return undefined;
  return row_to_npo(row);
}

export async function npo_by_slug(slug: string): Promise<INpo | undefined> {
  const [row] = await joined_select().where(
    eq(sql`LOWER(${npos.slug})`, slug.toLowerCase())
  );
  if (!row) return undefined;
  return row_to_npo(row);
}

export async function npos_batch_get(ids: number[]): Promise<INpo[]> {
  if (ids.length === 0) return [];
  const rows = await joined_select().where(inArray(npos.id, ids));
  return rows.map(row_to_npo);
}

export async function npo_by_regnum(
  rn: string,
  country = "United States"
): Promise<INpoWithRegNum | undefined> {
  const [row] = await db
    .select({
      id: npos.id,
      name: npos.name,
      hq_country: npos.hq_country,
      registration_number: npos.registration_number,
    })
    .from(npos)
    .where(and(eq(npos.registration_number, rn), eq(npos.hq_country, country)));
  return row;
}

const regnum_cols = {
  id: npos.id,
  name: npos.name,
  hq_country: npos.hq_country,
  registration_number: npos.registration_number,
};

/** US npos whose registration number has the same digits as one of `eins`.
 * stored values keep their dashes; `12-3456789` and `123456789` are one EIN. */
export async function npos_by_regnums(
  eins: string[]
): Promise<INpoWithRegNum[]> {
  const digits = [
    ...new Set(eins.map((ein) => ein.replace(/\D/g, "")).filter(Boolean)),
  ];
  if (digits.length === 0) return [];
  return db
    .select(regnum_cols)
    .from(npos)
    .where(
      and(
        eq(npos.hq_country, "United States"),
        sql`regexp_replace(${npos.registration_number}, '[^0-9]', '', 'g') in (${sql.join(
          digits.map((ein) => sql`${ein}`),
          sql`, `
        )})`
      )
    );
}

/**
 * the listing a would-be registrant would collide with: same registration
 * number + country AND at least one member behind it.
 *
 * deliberately not `npo_by_regnum`: that one matches any imported listing,
 * owned or not. membership is the only thing that means somebody can actually
 * invite the registrant in. the comparison folds case and trims —
 * registration input is lowercased on the way in while
 * `npos.registration_number` is stored verbatim.
 */
export async function npo_owned_by_regnum(
  rn: string,
  country: string
): Promise<{ id: number; name: string } | undefined> {
  const [row] = await db
    .select({ id: npos.id, name: npos.name })
    .from(npos)
    .where(
      and(
        eq(
          sql`LOWER(BTRIM(${npos.registration_number}))`,
          rn.trim().toLowerCase()
        ),
        eq(sql`LOWER(BTRIM(${npos.hq_country}))`, country.trim().toLowerCase()),
        exists(
          db
            .select({ x: sql`1` })
            .from(user_npo_memberships)
            .where(eq(user_npo_memberships.npo_id, npos.id))
        )
      )
    );
  return row;
}

export async function npos_referred_by(id: string): Promise<INpo[]> {
  const rows = await joined_select().where(
    or(eq(npos.referrer_user, id), eq(npos.referrer_npo, id))
  );
  return rows.map(row_to_npo);
}

export async function npo_by_rid(id: string): Promise<INpo | undefined> {
  const [row] = await joined_select().where(eq(npos.referral_id, id)).limit(1);
  if (!row) return undefined;
  return row_to_npo(row);
}

export async function npo_put(db: DbOrTx, data: NpoInsert) {
  await db.insert(npos).values(data);
}

export const slug_change_refused =
  "Your profile link is already set and can't be changed";

// no lookup sync needed — UNIQUE constraints handle slug/keyword/regnum.
// a slug, once stored, is permanent: campaign and donate links depend on it.
// the predicate and the write are one statement, so a concurrent first write
// rechecks the row after it takes the lock and matches nothing.
export async function npo_update(
  db: DbOrTx,
  id: number,
  update: Partial<Omit<NpoInsert, "id">>
): Promise<void> {
  const same_or_unset =
    "slug" in update
      ? or(
          isNull(npos.slug),
          eq(npos.slug, ""),
          ...(typeof update.slug === "string" && update.slug !== ""
            ? [eq(npos.slug, update.slug)]
            : [])
        )
      : undefined;
  const written = await db
    .update(npos)
    .set(update)
    .where(
      same_or_unset ? and(eq(npos.id, id), same_or_unset) : eq(npos.id, id)
    )
    .returning({ id: npos.id });
  if ("slug" in update && written.length === 0) {
    throw new Error(slug_change_refused);
  }
}

// balance-only adjustment — values are signed
export async function npo_balance_adj(
  db: DbOrTx,
  id: number,
  adj: Partial<Record<"liq" | "lock_units" | "cash", number>>
) {
  for (const [k, v] of Object.entries(adj)) {
    if (v != null) finite(v, `npo ${k} delta`);
  }
  await db
    .update(npos)
    .set({
      ...(adj.liq != null && {
        liq: sql`${npos.liq} + ${adj.liq}`,
      }),
      ...(adj.lock_units != null && {
        lock_units: sql`${npos.lock_units} + ${adj.lock_units}`,
      }),
      ...(adj.cash != null && {
        cash: sql`${npos.cash} + ${adj.cash}`,
      }),
    })
    .where(eq(npos.id, id));
}

export async function npo_balance_update(
  db: DbOrTx,
  id: number,
  d: IBalanceDeltas,
  dir: "inc" | "dec"
) {
  const s = dir === "inc" ? 1 : -1;
  // NaN is falsy: unchecked, the spreads below would drop it without a word
  finite(d.liq, "npo liq delta");
  finite(d.lock_units, "npo lock_units delta");
  finite(d.cash, "npo cash delta");
  await db
    .update(npos)
    .set({
      ...(d.liq && { liq: sql`${npos.liq} + ${s * d.liq}` }),
      ...(d.lock_units && {
        lock_units: sql`${npos.lock_units} + ${s * d.lock_units}`,
      }),
      ...(d.cash && { cash: sql`${npos.cash} + ${s * d.cash}` }),
    })
    .where(eq(npos.id, id));
}

export async function npo_balances_get(
  ids: number[]
): Promise<{ id: number; liq: number }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: npos.id, liq: npos.liq })
    .from(npos)
    .where(inArray(npos.id, ids));
  return rows.map((r) => ({ id: r.id, liq: r.liq ?? 0 }));
}

export async function npo_all_liq(): Promise<{ id: number; liq: number }[]> {
  const rows = await db.select({ id: npos.id, liq: npos.liq }).from(npos);
  return rows.map((r) => ({ id: r.id, liq: r.liq ?? 0 }));
}

export type TNameMatch = "exact" | "close";

export interface INpoNameHit {
  id: number;
  name: string;
  registration_number: string;
  hq_country: string;
  tagline: string | null;
  active: boolean;
  match: TNameMatch;
}

/**
 * the trigram similarity at which a listed name counts as the one queried,
 * when the query's words don't all appear in it. against "American Red
 * Cross": "American Cancer Society" 0.31, "Red Cross of Kenya" 0.36, the
 * "amercan red cross" typo 0.76, "American National Red Cross" 0.68.
 * word_similarity is no use here: it scores the first pair 0.53.
 */
export const NAME_MATCH_MIN = 0.4;
const NAME_HITS = 10;

const name_norm = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** listed npos the query names: exact, then a whole-word prefix, then every
 * query word as a whole word in the name, then by similarity. unlike `npo_search`, a row
 * sharing one trigram-heavy word ("American", "Cross") is not a hit */
export async function npo_name_search(query: string): Promise<INpoNameHit[]> {
  const q = name_norm(query);
  if (!q) return [];
  // alphanumerics and spaces only, so nothing in a LIKE pattern is a wildcard
  const words = q.split(" ").filter((w) => w.length > 1);
  const norm = sql`btrim(regexp_replace(lower(${npos.name}), '[^[:alnum:]]+', ' ', 'g'))`;
  const exact = sql`${norm} = ${q}`;
  const prefix = sql`${norm} LIKE ${`${q} %`}`;
  // padded so each word is matched whole: "red" must not hit "fred"
  const padded = sql`' ' || ${norm} || ' '`;
  const all_words = words.length
    ? sql`(${sql.join(
        words.map((w) => sql`${padded} LIKE ${`% ${w} %`}`),
        sql` AND `
      )})`
    : sql`false`;
  const sim = sql`similarity(${npos.name}, ${query})`;

  const rows = await db
    .select({
      id: npos.id,
      name: npos.name,
      registration_number: npos.registration_number,
      hq_country: npos.hq_country,
      tagline: npos.tagline,
      active: npos.active,
      exact: sql<boolean>`${exact}`,
    })
    .from(npos)
    .where(
      and(
        eq(npos.active, true),
        or(exact, all_words, sql`${sim} >= ${NAME_MATCH_MIN}`)
      )
    )
    .orderBy(
      desc(exact),
      desc(prefix),
      desc(all_words),
      desc(sim),
      asc(npos.name)
    )
    .limit(NAME_HITS);

  return rows.map(({ exact, ...r }) => ({
    ...r,
    match: exact ? "exact" : "close",
  }));
}

const HITS_PER_PAGE = 20;

// pg_trgm fuzzy search
export async function npo_search(
  params: Omit<INposSearchObj, "fields">
): Promise<INposPage> {
  const { query: q, page = 1, ...p } = params;

  const conditions: SQL[] = [eq(npos.active, true)];

  if (p.published?.length)
    conditions.push(inArray(npos.published, p.published));
  if (p.endow_designation?.length)
    conditions.push(inArray(npos.endow_designation, p.endow_designation));
  if (p.kyc_only?.length)
    conditions.push(inArray(npos.kyc_donors_only, p.kyc_only));
  if (p.fund_opt_in?.length)
    conditions.push(inArray(npos.fund_opt_in, p.fund_opt_in));
  if (p.sdgs?.length)
    conditions.push(
      sql`${npos.sdgs} && ARRAY[${sql.join(
        p.sdgs.map((s) => sql`${s}`),
        sql`, `
      )}]::int[]`
    );
  if (p.countries?.length) {
    conditions.push(
      or(
        inArray(npos.hq_country, p.countries),
        sql`${npos.active_in_countries} && ARRAY[${sql.join(
          p.countries.map((c) => sql`${c}`),
          sql`, `
        )}]::text[]`
      )!
    );
  }

  // pg_trgm similarity filter
  if (q) {
    conditions.push(
      or(
        sql`similarity(${npos.name}, ${q}) > 0.1`,
        sql`similarity(${npos.tagline}, ${q}) > 0.1`,
        sql`${npos.registration_number} ILIKE ${`%${q}%`}`
      )!
    );
  }

  const rank = q
    ? sql<number>`GREATEST(
        similarity(${npos.name}, ${q}) * 3,
        similarity(COALESCE(${npos.tagline}, ''), ${q}) * 2,
        similarity(${npos.registration_number}, ${q})
      )`
    : null;

  const rows = await db
    .select({
      id: npos.id,
      name: npos.name,
      card_img: npos.card_img,
      logo: npos.logo,
      image: npos.image,
      tagline: npos.tagline,
      hq_country: npos.hq_country,
      sdgs: npos.sdgs,
      active_in_countries: npos.active_in_countries,
      endow_designation: npos.endow_designation,
      registration_number: npos.registration_number,
      kyc_donors_only: npos.kyc_donors_only,
      published: npos.published,
      active: npos.active,
      fund_opt_in: npos.fund_opt_in,
      target_number: npos.target_number,
      target_smart: npos.target_smart,
      ...contributions,
      total: sql`COUNT(*) OVER()`.mapWith(Number),
    })
    .from(npos)
    .leftJoin(v_contributions, eq(v_contributions.npo_id, npos.id))
    .where(and(...conditions))
    .orderBy(rank ? desc(rank) : asc(npos.name))
    .limit(HITS_PER_PAGE)
    .offset((page - 1) * HITS_PER_PAGE);

  const total = rows[0]?.total ?? 0;

  return {
    items: rows.map((r) => {
      const { target_number, target_smart, total: _, ...rest } = r;
      return { ...rest, target: to_target(target_number, target_smart) };
    }),
    page,
    pages: Math.max(1, Math.ceil(total / HITS_PER_PAGE)),
  };
}
