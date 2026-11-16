import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  EDITABLE,
  type IReg,
  type IRegNew,
  type IRegsSearchObj,
  type TStatus,
} from "@/reg/schema";
import { db } from "../db";
import { registrations } from "../schema/registration";
import type { DbOrTx, IPage } from "./helpers";
import { decode_cursor, decode_date_cursor, encode_cursor } from "./helpers";

export async function reg_get(id: string): Promise<IReg | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id));
  // IReg is composed of many sub-interfaces with field shape mismatches
  return row as unknown as IReg | undefined;
}

/** the applicant's own application, most recently touched first.
 *
 * keyed on the address the row was written under, so a caller who can only
 * prove *who they are* — a draft grant, no session, no reference to quote —
 * still reaches nothing but their own. an applicant with several rows is
 * handed the one they were last working on. */
export async function reg_latest(r_id: string): Promise<IReg | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.r_id, r_id))
    .orderBy(desc(registrations.updated_at))
    .limit(1);
  // IReg is composed of many sub-interfaces with field shape mismatches
  return row as unknown as IReg | undefined;
}

export async function reg_put(data: IRegNew): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();

  const row = {
    id,
    r_id: data.r_id,
    status: "01" as const,
    // o_type travels with its identity column and hq country — see `reg_new`
    ...(data.o_type === "501c3"
      ? {
          o_type: data.o_type,
          o_ein: data.o_ein,
          o_hq_country: data.o_hq_country,
        }
      : {
          o_type: data.o_type,
          o_hq_country: data.o_hq_country,
          o_registration_number: data.o_registration_number,
        }),
    ...(data.o_name && { o_name: data.o_name }),
    ...(data.referrer && {
      rm: "referral",
      rm_referral_code: data.referrer,
    }),
    created_at: now,
    updated_at: now,
  };

  await db
    .insert(registrations)
    .values(row as typeof registrations.$inferInsert);

  return id;
}

export async function reg_update(
  db: DbOrTx,
  id: string,
  attrs: Record<string, any>
) {
  const { update_type: _, ...rest } = attrs;
  const [row] = await db
    .update(registrations)
    .set({ ...rest, updated_at: new Date().toISOString() })
    .where(eq(registrations.id, id))
    .returning();
  return row;
}

type TRegRow = typeof registrations.$inferSelect;

/** columns a guarded write may set: `updated_at` is stamped by the write. */
export type TRegAttrs = Partial<
  Omit<typeof registrations.$inferInsert, "id" | "updated_at">
>;

/** outcome of a guarded write. a miss carries the row as it now stands (null
 * when there is none), so a caller retrying a write that already committed —
 * its response lost, or the enqueue after it threw — finds the row in its
 * target state rather than reading the miss as a lost race. */
export type TRegCas =
  | { won: true; row: TRegRow }
  | { won: false; row: TRegRow | null };

const status_in = (from: TStatus[]) => inArray(registrations.status, from);

async function reg_cas(
  db: DbOrTx,
  id: string,
  guard: SQL | undefined,
  attrs: TRegAttrs
): Promise<TRegCas> {
  const [row] = await db
    .update(registrations)
    .set({ ...attrs, updated_at: new Date().toISOString() })
    .where(and(eq(registrations.id, id), guard))
    .returning();
  if (row) return { won: true, row };

  // a statement of its own: under read committed it takes a fresh snapshot,
  // so it sees the write that beat this one.
  const [current] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, id));
  return { won: false, row: current ?? null };
}

/** `reg_update`, applied only while the row's status is one of `from` — a
 * `null` in `from` matches a row with no status. nothing is written when it is
 * not, or when the row doesn't exist.
 *
 * the status is checked in the statement, not by a caller's read: a stale tab
 * or a second submit press races the review transition, and a write keyed on
 * id alone would pull a submitted or approved row back to draft. */
export function reg_update_from(
  db: DbOrTx,
  id: string,
  from: TStatus[],
  attrs: TRegAttrs,
  /** a further condition the row must meet, checked in the same statement */
  also?: SQL
): Promise<TRegCas> {
  return reg_cas(db, id, and(status_in(from), also), attrs);
}

/** what a disconnect event did to the registration holding `acct`. `stale`
 * when it connected the account after the event. `tied` when the connect
 * and the event fall in the same second, so the timestamps do not say which
 * was last. an approved one's account is its npo's, as `held_elsewhere`
 * reads it, and this leaves it */
export type TRegStripeDeauthorize =
  | { status: "cleared"; reg_id: string }
  | { status: "stale"; reg_id: string }
  | { status: "tied"; reg_id: string }
  | { status: "unknown" };

/** the registration holding `acct` disconnected us from it at `at`, the
 * event's stripe-clock creation time: it no longer holds one, so the
 * applicant can connect again. a connect newer than `at` keeps the account.
 * `tie` resolves a connect in the event's own second, as
 * `npo_stripe_deauthorize` does */
export async function reg_stripe_deauthorize(
  acct: string,
  at: string,
  conn: DbOrTx = db,
  tie: "ask" | "mark" | "stale" = "ask"
): Promise<TRegStripeDeauthorize> {
  // in the statement, so a connect committing first is re-read and kept.
  // null `o_stripe_connected_at`: saved before the stamp existed
  const older = sql`${registrations.o_stripe_connected_at} is null or ${registrations.o_stripe_connected_at} < ${at}::timestamptz`;
  const same_second = sql`${registrations.o_stripe_connected_at} is not null and date_trunc('second', ${registrations.o_stripe_connected_at}) = date_trunc('second', ${at}::timestamptz) and not (${older})`;
  const fresh = sql<boolean>`(${older} or (${tie === "mark"} and ${same_second}))`;
  const tied = sql<boolean>`(${tie === "ask"} and ${same_second})`;
  const [row] = await conn
    .update(registrations)
    .set({
      o_stripe_account_id: sql`case when ${fresh} then null else ${registrations.o_stripe_account_id} end`,
      o_stripe_connected_at: sql`case when ${fresh} then null else ${registrations.o_stripe_connected_at} end`,
      // a redelivery must not move the row up the applications list
      updated_at: sql`case when ${fresh} then now() else ${registrations.updated_at} end`,
    })
    .where(
      and(
        eq(registrations.o_stripe_account_id, acct),
        or(isNull(registrations.status), ne(registrations.status, "03"))
      )
    )
    .returning({ id: registrations.id, fresh, tied });
  if (!row) return { status: "unknown" };
  if (row.fresh) return { status: "cleared", reg_id: row.id };
  if (row.tied) return { status: "tied", reg_id: row.id };
  return { status: "stale", reg_id: row.id };
}

const PAGE = 15;
/** what the database writes for a timestamptz: a cursor for another sort is not one */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** a string postgres accepts as a parameter, which a NUL is not */
const sound = (x: unknown): x is string =>
  typeof x === "string" && !x.includes("\u0000");
/** a timestamp the database would read */
const is_timestamp = (x: string) =>
  ISO_TIMESTAMP.test(x) && !Number.isNaN(Date.parse(x));

/** a keyset cursor: the last row's sort value and id, and the sort it was
 * made under, utf-8 safe */
function encode_regs_cursor(
  sort_key: string,
  sort_dir: string,
  value: string | null,
  id: string
) {
  return encode_cursor({ k: sort_key, d: sort_dir, v: value, i: id });
}

type RegsCursor =
  | { kind: "keyset"; value: string | null; id: string }
  /** a bare date from before keyset paging */
  | { kind: "date"; date: string };

/** what `next` holds, or undefined for anything unreadable or made under
 * another sort: such a cursor starts the list over rather than failing it */
function decode_regs_cursor(
  next: string,
  sort_key: string,
  sort_dir: string
): RegsCursor | undefined {
  try {
    const x = decode_cursor(next);
    if (x && typeof x === "object" && "i" in x) {
      if (
        x.k === sort_key &&
        x.d === sort_dir &&
        sound(x.i) &&
        (x.v === null || sound(x.v)) &&
        // a timestamp must read as one, or the comparison fails in postgres
        (sort_key !== "updated_at" ||
          x.v === null ||
          is_timestamp(x.v as string))
      ) {
        return { kind: "keyset", value: x.v as string | null, id: x.i };
      }
      return undefined;
    }
  } catch {}
  try {
    const date = decode_date_cursor(next);
    if (date && is_timestamp(date)) return { kind: "date", date };
  } catch {}
  return undefined;
}

/**
 * paginated registrations with status/date/country filters. no status is
 * every status, newest first. paged by a keyset on (sort column, id), the id
 * breaking ties and nulls last, so a "view more" under any sort continues
 * where the page before it stopped
 */
export async function regs(opts?: IRegsSearchObj): Promise<IPage<IReg>> {
  const {
    status: asked_status,
    start_date,
    end_date,
    country,
    next,
    query,
    sort_key = "updated_at",
    sort_dir = "desc",
  } = opts || {};

  const sort_col_map = {
    o_name: registrations.o_name,
    updated_at: registrations.updated_at,
    o_hq_country: registrations.o_hq_country,
    status: registrations.status,
  } as const;
  const col = sort_col_map[sort_key];
  const desc_ = sort_dir !== "asc";
  const dir = desc_ ? desc : asc;

  const cursor = next
    ? decode_regs_cursor(next, sort_key, desc_ ? "desc" : "asc")
    : undefined;
  // a tab from before this default changed pages with a bare date and no
  // status, which then meant under review
  const status =
    cursor?.kind === "date" && asked_status === undefined ? "02" : asked_status;
  let after: SQL | undefined;
  if (cursor?.kind === "keyset") {
    const { value, id } = cursor;
    // a timestamp column compares as one, whatever the cursor's text
    const v =
      sort_key === "updated_at" ? sql`${value}::timestamptz` : sql`${value}`;
    const past = desc_ ? sql`<` : sql`>`;
    after =
      value === null
        ? // nulls sort last: only nulls with a later id remain
          sql`(${col} is null and ${registrations.id} ${past} ${id})`
        : sql`(${col} ${past} ${v} or (${col} = ${v} and ${registrations.id} ${past} ${id}) or ${col} is null)`;
  } else if (cursor?.kind === "date") {
    after = sql`${registrations.updated_at} < ${cursor.date}`;
  }

  const rows = await db
    .select()
    .from(registrations)
    .where(
      and(
        status ? eq(registrations.status, status) : undefined,
        start_date
          ? gte(registrations.updated_at, new Date(start_date).toISOString())
          : undefined,
        end_date
          ? lte(registrations.updated_at, new Date(end_date).toISOString())
          : undefined,
        country ? eq(registrations.o_hq_country, country) : undefined,
        query
          ? or(
              sql`similarity(${registrations.o_name}, ${query}) > 0.1`,
              sql`${registrations.id} ILIKE ${`%${query}%`}`
            )
          : undefined,
        after
      )
    )
    .orderBy(
      sql`${col} ${desc_ ? sql`desc` : sql`asc`} nulls last`,
      dir(registrations.id)
    )
    .limit(PAGE + 1);

  const has_more = rows.length > PAGE;
  const items = rows.slice(0, PAGE);
  const last = items[items.length - 1];
  return {
    // IReg is composed of many sub-interfaces with field shape mismatches
    items: items as unknown as IReg[],
    next:
      has_more && last
        ? encode_regs_cursor(
            sort_key,
            desc_ ? "desc" : "asc",
            (last[sort_key] as string | null | undefined) ?? null,
            last.id
          )
        : undefined,
  };
}

/** records a signing packet, and only onto the row it was generated from while
 * that row is still editable, putting it back to draft in the same write. a
 * miss means the row has moved on — the packet is orphaned, and the caller has
 * to start the agreement again rather than record it.
 *
 * `updated_at` is the version column: anvil mints the packet over the network,
 * and an identity or contact reset committing during that call would be undone
 * by an id-only write, putting a signing url and an eid back onto an identity
 * the packet does not assert. `reg_fsa_signed` would then accept that
 * packet's completion, since the eid it compares against is the restored
 * one. */
export function reg_fsa_packet(
  id: string,
  seen_at: string,
  attrs: TRegAttrs
): Promise<TRegCas> {
  return reg_cas(
    db,
    id,
    and(status_in(EDITABLE), eq(registrations.updated_at, seen_at)),
    { ...attrs, status: "01" }
  );
}

/** records the signed agreement, and only for the packet the row is still
 * waiting on, while the row is still editable. a miss is a superseded packet
 * or a replay after submit, not a failure. the status is left alone:
 * `reg_fsa_packet` set draft when it minted, and a replay landing after a
 * rejection would otherwise reopen the row.
 *
 * the predicate belongs in the statement rather than a caller's `if`, because
 * anvil's webhook races the reset paths: an identity or contact change
 * committing between a read and this write would be undone, putting the row
 * back to signed and re-opening the superseded document, since
 * `is_fsa_doc_eid` matches a signed url by its last path segment.
 *
 * a row predating `o_fsa_doc_eid` has no eid to compare against, so it is
 * recognised by the signing url those same paths clear. */
export function reg_fsa_signed(
  id: string,
  doc_eid: string,
  url: string
): Promise<TRegCas> {
  const awaited_packet = or(
    eq(registrations.o_fsa_doc_eid, doc_eid),
    and(
      isNull(registrations.o_fsa_doc_eid),
      isNotNull(registrations.o_fsa_signing_url)
    )
  );
  return reg_cas(db, id, and(status_in(EDITABLE), awaited_packet), {
    o_fsa_signed_doc_url: url,
  });
}

/** whether `eid` names a fund services agreement of ours.
 *
 * two records can carry it, and a row has one or the other:
 *
 * - `o_fsa_doc_eid`, stamped when the etch packet is CREATED — early enough
 *   that the success page anvil redirects to resolves, which a record written
 *   by the etch-complete webhook is not.
 * - the download url that webhook writes, whose last path segment is the eid.
 *   matched as a suffix because the origin half differs between staging and
 *   production, and it is what rows without the column are found by, so none
 *   of them needs a backfill. the eid arrives off a url path, so its `like`
 *   metacharacters are escaped: unescaped, a bare `%` would match every row
 *   that has ever signed one. */
export async function is_fsa_doc_eid(eid: string): Promise<boolean> {
  const suffix = eid.replace(/([%_\\])/g, "\\$1");
  const [row] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      or(
        eq(registrations.o_fsa_doc_eid, eid),
        like(registrations.o_fsa_signed_doc_url, `%/${suffix}`)
      )
    )
    .limit(1);
  return !!row;
}

/** the ein a public page may show for `npo_id`.
 *
 * approved is status `03` — the value the approval write sets, and the one
 * `reg_stripe_deauthorize` leaves alone — linked by `status_approved_npo_id`.
 * that row is chosen before `o_type` and `o_ein` are read, so a later `other`
 * or a blank ein hides an older 501(c)(3) instead of falling through to it.
 * `npos.registration_number` is a different field and is not read. */
export async function reg_public_ein(
  npo_id: number
): Promise<{ ein: string } | null> {
  const [row] = await db
    .select({
      o_type: registrations.o_type,
      o_ein: registrations.o_ein,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.status_approved_npo_id, npo_id),
        eq(registrations.status, "03")
      )
    )
    .orderBy(
      // `desc` puts nulls first, so a missing stamp would outrank a real one.
      // id orders a tie, so two rows with the same stamp don't swap between reads.
      sql`${registrations.updated_at} desc nulls last`,
      desc(registrations.id)
    )
    .limit(1);

  if (row?.o_type !== "501c3") return null;
  const ein = row.o_ein?.trim() ?? "";
  if (ein === "") return null;
  return { ein };
}
