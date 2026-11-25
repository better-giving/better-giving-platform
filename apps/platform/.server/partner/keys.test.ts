import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { DbOrTx } from "../pg/queries/helpers";
import { user } from "../pg/schema/auth";
import { npos } from "../pg/schema/npo";
import { partner_keys, partner_tenants } from "../pg/schema/partner";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";
import {
  event_secret_get,
  find_live_key,
  list_keys,
  mint_key,
  revoke_key,
  rotate_key,
} from "./keys";

// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as DbOrTx;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

let t: TestDb;

beforeAll(async () => {
  t = await create_test_db();
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  await t.db.delete(partner_keys);
  await t.db.delete(partner_tenants);
  await t.db.delete(npos);
  await t.db.delete(user);
});

const seed_pair = async () => {
  const npo = (await seed_npo(t.db, {
    name: "Red Bird",
    registration_number: "EIN-RB",
  }))!;
  const staff = (await seed_user(t.db, "ada@test.com", "Ada", "Lovelace"))!;
  return { npo, staff };
};

/** every string in every partner row, to search for a leaked secret */
const stored_strings = async () => {
  const rows = [
    ...(await t.db.select().from(partner_keys)),
    ...(await t.db.select().from(partner_tenants)),
  ];
  return rows.flatMap((r) =>
    Object.values(r).filter((x): x is string => typeof x === "string")
  );
};

describe("mint_key", () => {
  test("returns an spk_ key once and stores only its hash, prefix and last4", async () => {
    const { npo, staff } = await seed_pair();

    const minted = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });

    expect(minted.key).toMatch(/^spk_[A-Za-z0-9_-]{43}$/);
    const [row] = await t.db
      .select()
      .from(partner_keys)
      .where(eq(partner_keys.id, minted.id));
    expect(row).toMatchObject({
      npo_id: npo.id,
      key_hash: sha256_hex(minted.key),
      prefix: minted.key.slice(0, 8),
      last4: minted.key.slice(-4),
      minted_by: staff.id,
      revoked_at: null,
    });
    for (const s of await stored_strings()) {
      expect(s).not.toContain(minted.key);
    }
  });

  test("the first mint creates the tenant with its event secret sealed, and returns that secret once", async () => {
    const { npo, staff } = await seed_pair();

    const first = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    const second = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });

    expect(first.event_secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(second.event_secret).toBeNull();
    const tenants = await t.db.select().from(partner_tenants);
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.npo_id).toBe(npo.id);
    const raw = first.event_secret!;
    for (const s of await stored_strings()) {
      expect(s).not.toContain(raw);
      expect(s).not.toContain(raw.slice("whsec_".length));
    }
    expect(await event_secret_get(as_db(t.db), npo.id)).toBe(raw);
  });

  test("event_secret_get is null for a nonprofit with no tenant", async () => {
    const { npo } = await seed_pair();
    expect(await event_secret_get(as_db(t.db), npo.id)).toBeNull();
  });
});

describe("find_live_key", () => {
  test("finds a minted key's id and nonprofit, and nothing for an unknown or malformed token", async () => {
    const { npo, staff } = await seed_pair();
    const minted = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });

    expect(await find_live_key(as_db(t.db), minted.key)).toEqual({
      id: minted.id,
      npo_id: npo.id,
    });
    const unknown = `spk_${"A".repeat(43)}`;
    expect(await find_live_key(as_db(t.db), unknown)).toBeNull();
    expect(await find_live_key(as_db(t.db), `${minted.key}x`)).toBeNull();
    expect(
      await find_live_key(as_db(t.db), minted.key.replace("spk_", "bgc_"))
    ).toBeNull();
  });

  test("touches last_used_at at most once a minute", async () => {
    const { npo, staff } = await seed_pair();
    const minted = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    const at = (iso: string) => new Date(iso);
    const used = async () =>
      (
        await t.db
          .select({ last_used_at: partner_keys.last_used_at })
          .from(partner_keys)
      )[0]!.last_used_at;

    await find_live_key(as_db(t.db), minted.key, at("2026-11-25T10:00:00Z"));
    await find_live_key(as_db(t.db), minted.key, at("2026-11-25T10:00:59Z"));
    expect(new Date(String(await used())).toISOString()).toBe(
      "2026-11-25T10:00:00.000Z"
    );
    await find_live_key(as_db(t.db), minted.key, at("2026-11-25T10:01:01Z"));
    expect(new Date(String(await used())).toISOString()).toBe(
      "2026-11-25T10:01:01.000Z"
    );
  });

  test("a revoked key is not live, and revoke needs the key's own nonprofit", async () => {
    const { npo, staff } = await seed_pair();
    const other = (await seed_npo(t.db, { registration_number: "EIN-OT" }))!;
    const minted = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });

    expect(
      await revoke_key(as_db(t.db), {
        id: minted.id,
        npo_id: other.id,
        revoked_by: staff.id,
      })
    ).toBe(false);
    expect(await find_live_key(as_db(t.db), minted.key)).not.toBeNull();

    expect(
      await revoke_key(as_db(t.db), {
        id: minted.id,
        npo_id: npo.id,
        revoked_by: staff.id,
      })
    ).toBe(true);
    expect(await find_live_key(as_db(t.db), minted.key)).toBeNull();
    const [row] = await t.db.select().from(partner_keys);
    expect(row!.revoked_by).toBe(staff.id);
    expect(
      await revoke_key(as_db(t.db), {
        id: minted.id,
        npo_id: npo.id,
        revoked_by: staff.id,
      })
    ).toBe(false);
  });
});

describe("rotate_key", () => {
  test("revokes every live key of the nonprofit and returns a new working key, no event secret", async () => {
    const { npo, staff } = await seed_pair();
    const other = (await seed_npo(t.db, { registration_number: "EIN-OT" }))!;
    const a = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    const b = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    const theirs = await mint_key(as_db(t.db), {
      npo_id: other.id,
      minted_by: staff.id,
    });
    const secret = await event_secret_get(as_db(t.db), npo.id);

    const rotated = await rotate_key(as_db(t.db), {
      npo_id: npo.id,
      rotated_by: staff.id,
    });

    expect(rotated).toMatchObject({ revoked: 2 });
    expect(rotated).not.toHaveProperty("event_secret");
    expect(await find_live_key(as_db(t.db), a.key)).toBeNull();
    expect(await find_live_key(as_db(t.db), b.key)).toBeNull();
    expect(await find_live_key(as_db(t.db), rotated!.key)).toEqual({
      id: rotated!.id,
      npo_id: npo.id,
    });
    expect(await find_live_key(as_db(t.db), theirs.key)).not.toBeNull();
    expect(await event_secret_get(as_db(t.db), npo.id)).toBe(secret);
  });

  test("is null for a nonprofit that never minted, and creates nothing", async () => {
    const { npo, staff } = await seed_pair();

    expect(
      await rotate_key(as_db(t.db), { npo_id: npo.id, rotated_by: staff.id })
    ).toBeNull();
    expect(await t.db.select().from(partner_keys)).toHaveLength(0);
    expect(await t.db.select().from(partner_tenants)).toHaveLength(0);
  });
});

describe("list_keys", () => {
  test("lists the nonprofit's keys, live and revoked, newest first, with no hash", async () => {
    const { npo, staff } = await seed_pair();
    const other = (await seed_npo(t.db, { registration_number: "EIN-OT" }))!;
    const a = await mint_key(as_db(t.db), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    await rotate_key(as_db(t.db), { npo_id: npo.id, rotated_by: staff.id });
    await mint_key(as_db(t.db), { npo_id: other.id, minted_by: staff.id });

    const listed = await list_keys(as_db(t.db), npo.id);

    expect(listed).toHaveLength(2);
    expect(Object.keys(listed[0]!).sort()).toEqual([
      "created_at",
      "id",
      "last4",
      "last_used_at",
      "prefix",
      "revoked_at",
    ]);
    expect(listed[1]).toMatchObject({ id: a.id, prefix: a.prefix });
    expect(listed[1]!.revoked_at).not.toBeNull();
    expect(listed[0]!.revoked_at).toBeNull();
  });
});
