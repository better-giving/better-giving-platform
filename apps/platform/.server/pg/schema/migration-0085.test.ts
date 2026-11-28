import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  create_test_db,
  seed_npo_sql,
  type TestDb,
} from "../test-utils/pglite";
import { user } from "./auth";
import { npos } from "./npo";
import { partner_keys, partner_tenants } from "./partner";

// 0085 adds the partner api key store: a hash-only key per org, and the org's
// tenant row holding its event secret envelope. both go with the org.
let t: TestDb;
let npo: number;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const key = (id: string) => ({
  id,
  npo_id: npo,
  key_hash: sha256_hex(id),
  prefix: "spk_abcd",
  last4: "wxyz",
  minted_by: "u-0085",
});

beforeAll(async () => {
  t = await create_test_db();
  await t.db.insert(user).values({
    id: "u-0085",
    name: "U",
    email: "u-0085@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "U",
    last_name: "U",
  });
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  await t.db.delete(partner_keys);
  await t.db.delete(partner_tenants);
  await t.db.delete(npos);
  npo = await seed_npo_sql(t.client, "EIN-0085");
});

test("key_hash must be 64 lowercase hex chars, so a raw key cannot be stored", async () => {
  await expect(
    t.db
      .insert(partner_keys)
      .values({ ...key("raw"), key_hash: "spk_live_raw_key" })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_key_hash_hex" },
  });
  await expect(
    t.db
      .insert(partner_keys)
      .values({ ...key("upper"), key_hash: sha256_hex("upper").toUpperCase() })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_key_hash_hex" },
  });
  await t.db.insert(partner_keys).values(key("hashed"));
  expect(await t.db.select().from(partner_keys)).toHaveLength(1);
});

test("key_hash is exactly 64 chars, not 63 or 65", async () => {
  const hash = sha256_hex("len");
  for (const [id, key_hash] of [
    ["short", hash.slice(0, 63)],
    ["long", `${hash}a`],
  ]) {
    await expect(
      t.db.insert(partner_keys).values({ ...key(id), key_hash })
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "partner_keys_key_hash_hex" },
    });
  }
  expect(await t.db.select().from(partner_keys)).toHaveLength(0);
});

test("prefix is exactly 8 chars and last4 exactly 4", async () => {
  await expect(
    t.db.insert(partner_keys).values({ ...key("p9"), prefix: "spk_abcde" })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_prefix_len" },
  });
  await expect(
    t.db.insert(partner_keys).values({ ...key("l3"), last4: "wxy" })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_last4_len" },
  });
  await expect(
    t.db.insert(partner_keys).values({ ...key("p"), prefix: "spk_abc" })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_prefix_len" },
  });
  await expect(
    t.db.insert(partner_keys).values({ ...key("l"), last4: "wxyz1" })
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "partner_keys_last4_len" },
  });
});

test("key_hash is unique", async () => {
  await t.db.insert(partner_keys).values(key("one"));
  await expect(
    t.db
      .insert(partner_keys)
      .values({ ...key("two"), key_hash: sha256_hex("one") })
  ).rejects.toMatchObject({
    cause: { code: "23505", constraint: "partner_keys_key_hash_unique" },
  });
});

test("deleting the org deletes its tenant row and keys, and only its own", async () => {
  const other = await seed_npo_sql(t.client, "EIN-0085-B");
  await t.db.insert(partner_tenants).values([
    { npo_id: npo, event_secret: "envelope-mine" },
    { npo_id: other, event_secret: "envelope-other" },
  ]);
  await t.db
    .insert(partner_keys)
    .values([key("mine"), { ...key("other"), npo_id: other }]);

  await t.db.delete(npos).where(eq(npos.id, other));

  const tenants = await t.db.select().from(partner_tenants);
  expect(tenants.map((r) => r.npo_id)).toEqual([npo]);
  const keys = await t.db.select().from(partner_keys);
  expect(keys.map((r) => r.id)).toEqual(["mine"]);
});

test("deleting the minting user keeps the key with minted_by nulled", async () => {
  await t.db.insert(user).values({
    id: "u-0085-minter",
    name: "M",
    email: "u-0085-minter@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "M",
    last_name: "M",
  });
  await t.db
    .insert(partner_keys)
    .values({ ...key("minted"), minted_by: "u-0085-minter" });

  await t.db.delete(user).where(eq(user.id, "u-0085-minter"));

  const rows = await t.db.select().from(partner_keys);
  expect(rows.map((r) => [r.id, r.minted_by])).toEqual([["minted", null]]);
});

test("deleting the revoking user keeps the revoked key with revoked_by nulled", async () => {
  const revoked_at = "2026-01-02T03:04:05.000Z";
  await t.db.insert(user).values({
    id: "u-0085-revoker",
    name: "R",
    email: "u-0085-revoker@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "R",
    last_name: "R",
  });
  await t.db
    .insert(partner_keys)
    .values({ ...key("revoked"), revoked_at, revoked_by: "u-0085-revoker" });

  await t.db.delete(user).where(eq(user.id, "u-0085-revoker"));

  const rows = await t.db.select().from(partner_keys);
  expect(rows.map((r) => [r.id, r.revoked_by, r.revoked_at])).toEqual([
    ["revoked", null, revoked_at],
  ]);
});

test("a tenant row starts at revision 0 with no fingerprint", async () => {
  await t.db
    .insert(partner_tenants)
    .values({ npo_id: npo, event_secret: "envelope" });

  const rows = await t.db.select().from(partner_tenants);
  expect(rows).toEqual([
    {
      npo_id: npo,
      event_secret: "envelope",
      revision: 0,
      fingerprint: null,
      created_at: expect.stringMatching(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/
      ),
    },
  ]);
});

test("an org has one tenant row", async () => {
  await t.db
    .insert(partner_tenants)
    .values({ npo_id: npo, event_secret: "first" });
  await expect(
    t.db.insert(partner_tenants).values({ npo_id: npo, event_secret: "second" })
  ).rejects.toMatchObject({ cause: { code: "23505" } });
  const rows = await t.db.select().from(partner_tenants);
  expect(rows.map((r) => r.event_secret)).toEqual(["first"]);
});

test("a tenant row requires its event secret", async () => {
  await expect(
    t.db
      .insert(partner_tenants)
      .values({ npo_id: npo, event_secret: null as unknown as string })
  ).rejects.toMatchObject({
    cause: { code: "23502", column: "event_secret" },
  });
});

test("a key cannot be minted for an org that does not exist", async () => {
  await expect(
    t.db.insert(partner_keys).values({ ...key("orphan"), npo_id: npo + 9999 })
  ).rejects.toMatchObject({ cause: { code: "23503" } });
});
