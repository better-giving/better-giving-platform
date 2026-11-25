import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { app } from "../env";
import type { DbOrTx } from "../pg/queries/helpers";
import { partner_keys, partner_tenants } from "../pg/schema/partner";

const KEY_RE = /^spk_[A-Za-z0-9_-]{43}$/;
const USED_TOUCH_MS = 60_000;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** iv(12) | ciphertext | tag(16), base64url — the envelope `api_key_put`
 * builds in queries/api-key.ts, under the same key */
function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(app.api_encryption_key, "base64"),
    iv
  );
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url");
}

function unseal(envelope: string): string {
  const all = Buffer.from(envelope, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(app.api_encryption_key, "base64"),
    all.subarray(0, 12)
  );
  decipher.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([
    decipher.update(all.subarray(12, all.length - 16)),
    decipher.final(),
  ]).toString("utf8");
}

export interface MintedKey {
  id: string;
  /** the only time the key exists outside its hash */
  key: string;
  prefix: string;
  last4: string;
}

async function insert_key(
  db: DbOrTx,
  npo_id: number,
  minted_by: string | null
): Promise<MintedKey> {
  const key = `spk_${randomBytes(32).toString("base64url")}`;
  const row = {
    id: crypto.randomUUID(),
    prefix: key.slice(0, 8),
    last4: key.slice(-4),
  };
  await db
    .insert(partner_keys)
    .values({ ...row, npo_id, key_hash: sha256_hex(key), minted_by });
  return { ...row, key };
}

/** a new key for the nonprofit. the first mint also creates its tenant, and
 * only that mint returns the tenant's `whsec_` event secret — every later one
 * returns null, since the secret is stored sealed and never shown again */
export async function mint_key(
  db: DbOrTx,
  args: { npo_id: number; minted_by: string | null }
): Promise<MintedKey & { event_secret: string | null }> {
  return db.transaction(async (tx) => {
    const secret = `whsec_${randomBytes(32).toString("base64")}`;
    const created = await tx
      .insert(partner_tenants)
      .values({ npo_id: args.npo_id, event_secret: seal(secret) })
      .onConflictDoNothing()
      .returning({ npo_id: partner_tenants.npo_id });
    const minted = await insert_key(tx, args.npo_id, args.minted_by);
    return { ...minted, event_secret: created.length > 0 ? secret : null };
  });
}

/** a new key, with every live key the nonprofit had revoked in the same
 * commit. null when the nonprofit has no tenant: there is nothing to rotate,
 * and minting here would create an event secret nobody is ever shown */
export async function rotate_key(
  db: DbOrTx,
  args: { npo_id: number; rotated_by: string | null }
): Promise<(MintedKey & { revoked: number }) | null> {
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ npo_id: partner_tenants.npo_id })
      .from(partner_tenants)
      .where(eq(partner_tenants.npo_id, args.npo_id))
      .for("update");
    if (!tenant) return null;
    const revoked = await tx
      .update(partner_keys)
      .set({
        revoked_at: new Date().toISOString(),
        revoked_by: args.rotated_by,
      })
      .where(
        and(
          eq(partner_keys.npo_id, args.npo_id),
          isNull(partner_keys.revoked_at)
        )
      )
      .returning({ id: partner_keys.id });
    const minted = await insert_key(tx, args.npo_id, args.rotated_by);
    return { ...minted, revoked: revoked.length };
  });
}

/** false when no live key of that nonprofit has that id */
export async function revoke_key(
  db: DbOrTx,
  args: { id: string; npo_id: number; revoked_by: string | null }
): Promise<boolean> {
  const rows = await db
    .update(partner_keys)
    .set({ revoked_at: new Date().toISOString(), revoked_by: args.revoked_by })
    .where(
      and(
        eq(partner_keys.id, args.id),
        eq(partner_keys.npo_id, args.npo_id),
        isNull(partner_keys.revoked_at)
      )
    )
    .returning({ id: partner_keys.id });
  return rows.length === 1;
}

/** the key's id and nonprofit; null for a revoked, unknown or malformed token */
export async function find_live_key(
  db: DbOrTx,
  token: string,
  now = new Date()
): Promise<{ id: string; npo_id: number } | null> {
  if (!KEY_RE.test(token)) return null;
  const stale_before = new Date(now.getTime() - USED_TOUCH_MS).toISOString();
  const live = and(
    eq(partner_keys.key_hash, sha256_hex(token)),
    isNull(partner_keys.revoked_at)
  );
  const shape = { id: partner_keys.id, npo_id: partner_keys.npo_id };
  // touch at most once a minute; a fresher stamp is left as it is
  const [touched] = await db
    .update(partner_keys)
    .set({ last_used_at: now.toISOString() })
    .where(
      and(
        live,
        or(
          isNull(partner_keys.last_used_at),
          lt(partner_keys.last_used_at, stale_before)
        )
      )
    )
    .returning(shape);
  if (touched) return touched;
  const [row] = await db.select(shape).from(partner_keys).where(live);
  return row ?? null;
}

export async function list_keys(
  db: DbOrTx,
  npo_id: number
): Promise<
  Array<{
    id: string;
    prefix: string;
    last4: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>
> {
  return db
    .select({
      id: partner_keys.id,
      prefix: partner_keys.prefix,
      last4: partner_keys.last4,
      created_at: partner_keys.created_at,
      last_used_at: partner_keys.last_used_at,
      revoked_at: partner_keys.revoked_at,
    })
    .from(partner_keys)
    .where(eq(partner_keys.npo_id, npo_id))
    .orderBy(desc(partner_keys.created_at), desc(partner_keys.id));
}

/** the tenant's `whsec_` secret, for signing events; null with no tenant */
export async function event_secret_get(
  db: DbOrTx,
  npo_id: number
): Promise<string | null> {
  const [row] = await db
    .select({ event_secret: partner_tenants.event_secret })
    .from(partner_tenants)
    .where(eq(partner_tenants.npo_id, npo_id));
  return row ? unseal(row.event_secret) : null;
}
