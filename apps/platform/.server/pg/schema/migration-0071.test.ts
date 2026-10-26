import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  create_test_db,
  seed_npo_sql,
  type TestDb,
} from "../test-utils/pglite";
import { user } from "./auth";
import { campaigns } from "./campaign";
import { connector_photo_links } from "./connector";
import { npos } from "./npo";

// 0071 adds connector_photo_links: a hashed single-use token bound to one
// campaign of one org, gone with either.
let t: TestDb;
let npo: number;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const link = (id: string, campaign_id = "c-a") => ({
  id,
  token_hash: sha256_hex(id),
  npo_id: npo,
  campaign_id,
  expires_at: "2026-10-17T15:15:00.000Z",
});

beforeAll(async () => {
  t = await create_test_db();
  await t.db.insert(user).values({
    id: "u-0071",
    name: "U",
    email: "u-0071@test.com",
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
  await t.db.delete(connector_photo_links);
  await t.db.delete(campaigns);
  await t.db.delete(npos);
  npo = await seed_npo_sql(t.client, "EIN-0071");
  await t.db.insert(campaigns).values(
    ["c-a", "c-b"].map((id) => ({
      id,
      owner_npo_id: npo,
      creator_id: "u-0071",
      name: id,
      slug: id,
    }))
  );
});

test("token_hash must be 64 lowercase hex chars, so a raw token cannot be stored", async () => {
  await expect(
    t.db
      .insert(connector_photo_links)
      .values({ ...link("raw"), token_hash: "A".repeat(43) })
  ).rejects.toMatchObject({
    cause: {
      code: "23514",
      constraint: "connector_photo_links_token_hash_hex",
    },
  });
  await t.db.insert(connector_photo_links).values(link("hashed"));
  expect(await t.db.select().from(connector_photo_links)).toHaveLength(1);
});

test("token_hash is unique", async () => {
  await t.db.insert(connector_photo_links).values(link("one"));
  await expect(
    t.db
      .insert(connector_photo_links)
      .values({ ...link("two"), token_hash: sha256_hex("one") })
  ).rejects.toMatchObject({
    cause: {
      code: "23505",
      constraint: "connector_photo_links_token_hash_unique",
    },
  });
});

test("deleting a campaign deletes only its links", async () => {
  await t.db
    .insert(connector_photo_links)
    .values([link("for-a", "c-a"), link("for-b", "c-b")]);

  await t.db.delete(campaigns).where(eq(campaigns.id, "c-a"));

  const rows = await t.db.select().from(connector_photo_links);
  expect(rows.map((r) => r.id)).toEqual(["for-b"]);
});

test("deleting the org deletes its links", async () => {
  // an org with no campaigns can be deleted, which isolates the npo cascade
  const other = await seed_npo_sql(t.client, "EIN-0071-B");
  await t.db
    .insert(connector_photo_links)
    .values([link("mine"), { ...link("other"), npo_id: other }]);

  await t.db.delete(npos).where(eq(npos.id, other));

  const rows = await t.db.select().from(connector_photo_links);
  expect(rows.map((r) => r.id)).toEqual(["mine"]);
});
