import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../pg/queries/helpers";
import { user } from "../pg/schema/auth";
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
  connector_photo_links,
} from "../pg/schema/connector";
import { npos } from "../pg/schema/npo";
import { user_npo_memberships } from "../pg/schema/user";
import { PHOTO_LINK_KEEP_MS } from "./photo-links";

class MembershipGone extends Error {
  constructor() {
    super("connector membership gone");
  }
}

const membership_gone = (err: unknown): boolean => {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e instanceof MembershipGone) return true;
  }
  return false;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const USED_TOUCH_MS = 60_000;
const IDLE_MS = 90 * 24 * 60 * 60 * 1000;
const IDEM_MS = 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const KEY_RE = /^bgc_[A-Za-z0-9_-]{43}$/;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export async function issue_code(
  db: DbOrTx,
  args: { npo_id: number; allowed_by: string; iss: string; now?: Date }
): Promise<{ code: string; expires_at: string }> {
  const now = args.now ?? new Date();
  const code = randomBytes(32).toString("base64url");
  const expires_at = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  await db.insert(connector_codes).values({
    code_hash: sha256_hex(code),
    npo_id: args.npo_id,
    allowed_by: args.allowed_by,
    iss: args.iss,
    expires_at,
  });
  return { code, expires_at };
}

export async function exchange_code(
  db: DbOrTx,
  code: string,
  now = new Date(),
  hold?: (tx: DbOrTx) => Promise<void>
): Promise<
  | { ok: true; key: string; key_id: string; npo_id: number; name: string }
  | { ok: false }
> {
  if (!CODE_RE.test(code)) return { ok: false };
  const now_iso = now.toISOString();
  try {
    return await db.transaction(async (tx) => {
      const code_hash = sha256_hex(code);
      const [pending] = await tx
        .select({
          npo_id: connector_codes.npo_id,
          allowed_by: connector_codes.allowed_by,
        })
        .from(connector_codes)
        .where(
          and(
            eq(connector_codes.code_hash, code_hash),
            isNull(connector_codes.used_at),
            gt(connector_codes.expires_at, now_iso)
          )
        );
      if (!pending) return { ok: false };
      // membership before the code claim, same order as member removal
      // (delete the membership, then revoke keys and unused codes)
      const [member] = await tx
        .select({ user_id: user_npo_memberships.user_id })
        .from(user_npo_memberships)
        .where(
          and(
            eq(user_npo_memberships.npo_id, pending.npo_id),
            eq(user_npo_memberships.user_id, pending.allowed_by)
          )
        )
        .for("share");
      // throw, not { ok: false }: the claim below must not commit without a member
      if (!member) throw new MembershipGone();
      if (hold) await hold(tx);
      const [claimed] = await tx
        .update(connector_codes)
        .set({ used_at: now_iso })
        .where(
          and(
            eq(connector_codes.code_hash, code_hash),
            isNull(connector_codes.used_at),
            gt(connector_codes.expires_at, now_iso)
          )
        )
        .returning({
          npo_id: connector_codes.npo_id,
          allowed_by: connector_codes.allowed_by,
        });
      if (!claimed) return { ok: false };
      const key = `bgc_${randomBytes(32).toString("base64url")}`;
      const key_id = crypto.randomUUID();
      await tx.insert(connector_keys).values({
        id: key_id,
        npo_id: claimed.npo_id,
        key_hash: sha256_hex(key),
        prefix: key.slice(0, 8),
        last4: key.slice(-4),
        allowed_by: claimed.allowed_by,
      });
      const [npo] = await tx
        .select({ name: npos.name })
        .from(npos)
        .where(eq(npos.id, claimed.npo_id));
      if (!npo) throw new Error(`connector code npo ${claimed.npo_id} missing`);
      return {
        ok: true,
        key,
        key_id,
        npo_id: claimed.npo_id,
        name: npo.name,
      };
    });
  } catch (err) {
    if (membership_gone(err)) return { ok: false };
    throw err;
  }
}

export async function find_live_key(
  db: DbOrTx,
  token: string,
  now = new Date()
): Promise<{ id: string; npo_id: number; allowed_by: string } | null> {
  if (!KEY_RE.test(token)) return null;
  const now_iso = now.toISOString();
  const stale_before = new Date(now.getTime() - USED_TOUCH_MS).toISOString();
  const hash = sha256_hex(token);
  const live = () =>
    and(eq(connector_keys.key_hash, hash), isNull(connector_keys.revoked_at));
  const shape = {
    id: connector_keys.id,
    npo_id: connector_keys.npo_id,
    allowed_by: connector_keys.allowed_by,
  };
  // touch at most once a minute; a fresher stamp is left as it is
  const [touched] = await db
    .update(connector_keys)
    .set({ last_used_at: now_iso })
    .where(
      and(
        live(),
        or(
          isNull(connector_keys.last_used_at),
          lt(connector_keys.last_used_at, stale_before)
        )
      )
    )
    .returning(shape);
  if (touched) return touched;
  const [row] = await db.select(shape).from(connector_keys).where(live());
  return row ?? null;
}

export async function revoke_key(
  db: DbOrTx,
  args: { id: string; npo_id: number; revoked_by: string | null }
): Promise<boolean> {
  const rows = await db
    .update(connector_keys)
    .set({ revoked_at: new Date().toISOString(), revoked_by: args.revoked_by })
    .where(
      and(
        eq(connector_keys.id, args.id),
        eq(connector_keys.npo_id, args.npo_id),
        isNull(connector_keys.revoked_at)
      )
    )
    .returning({ id: connector_keys.id });
  return rows.length === 1;
}

export async function revoke_member_keys(
  db: DbOrTx,
  args: { npo_id: number; user_id: string; revoked_by: string | null }
): Promise<number> {
  const rows = await db
    .update(connector_keys)
    .set({ revoked_at: new Date().toISOString(), revoked_by: args.revoked_by })
    .where(
      and(
        eq(connector_keys.npo_id, args.npo_id),
        eq(connector_keys.allowed_by, args.user_id),
        isNull(connector_keys.revoked_at)
      )
    )
    .returning({ id: connector_keys.id });
  await db
    .delete(connector_codes)
    .where(
      and(
        eq(connector_codes.npo_id, args.npo_id),
        eq(connector_codes.allowed_by, args.user_id),
        isNull(connector_codes.used_at)
      )
    );
  return rows.length;
}

export async function list_live_keys(
  db: DbOrTx,
  npo_id: number
): Promise<
  Array<{
    id: string;
    prefix: string;
    last4: string;
    allowed_by: string;
    allowed_by_name: string;
    created_at: string;
    last_used_at: string | null;
  }>
> {
  return db
    .select({
      id: connector_keys.id,
      prefix: connector_keys.prefix,
      last4: connector_keys.last4,
      allowed_by: connector_keys.allowed_by,
      allowed_by_name: user.name,
      created_at: connector_keys.created_at,
      last_used_at: connector_keys.last_used_at,
    })
    .from(connector_keys)
    .innerJoin(user, eq(user.id, connector_keys.allowed_by))
    .where(
      and(eq(connector_keys.npo_id, npo_id), isNull(connector_keys.revoked_at))
    )
    .orderBy(desc(connector_keys.created_at), desc(connector_keys.id));
}

export async function sweep(
  db: DbOrTx,
  now = new Date()
): Promise<{
  keys_revoked: number;
  codes_deleted: number;
  idempotency_deleted: number;
  photo_links_deleted: number;
}> {
  const now_iso = now.toISOString();
  const idle_before = new Date(now.getTime() - IDLE_MS).toISOString();
  const idem_before = new Date(now.getTime() - IDEM_MS).toISOString();
  const photo_before = new Date(
    now.getTime() - PHOTO_LINK_KEEP_MS
  ).toISOString();
  const revoked = await db
    .update(connector_keys)
    .set({ revoked_at: now_iso, revoked_by: null })
    .where(
      and(
        isNull(connector_keys.revoked_at),
        sql`coalesce(${connector_keys.last_used_at}, ${connector_keys.created_at}) < ${idle_before}::timestamptz`
      )
    )
    .returning({ id: connector_keys.id });
  const codes = await db
    .delete(connector_codes)
    .where(lt(connector_codes.expires_at, now_iso))
    .returning({ code_hash: connector_codes.code_hash });
  const idem = await db
    .delete(connector_idempotency)
    .where(lt(connector_idempotency.created_at, idem_before))
    .returning({ idem_key: connector_idempotency.idem_key });
  // a link that saved a photo stays: it is the proof that photo belongs to
  // its campaign, so a later blocks write can put it back. Its page still
  // ends on time, since `saved_photo_link` reads it only within the window
  const photo_links = await db
    .delete(connector_photo_links)
    .where(
      and(
        lt(connector_photo_links.expires_at, photo_before),
        isNull(connector_photo_links.saved_pathname)
      )
    )
    .returning({ id: connector_photo_links.id });
  return {
    keys_revoked: revoked.length,
    codes_deleted: codes.length,
    idempotency_deleted: idem.length,
    photo_links_deleted: photo_links.length,
  };
}
