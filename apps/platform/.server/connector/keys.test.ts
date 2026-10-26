import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
} from "../pg/schema/connector";
import { npos } from "../pg/schema/npo";
import { user_npo_memberships } from "../pg/schema/user";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";
import {
  exchange_code,
  find_live_key,
  issue_code,
  list_live_keys,
  revoke_key,
  revoke_member_keys,
  sweep,
} from "./keys";

// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as DbOrTx;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const NOW = new Date("2026-10-17T15:00:00.000Z");
const TEN_MIN_MS = 10 * 60 * 1000;

let t: TestDb;

beforeAll(async () => {
  t = await create_test_db();
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  await t.db.delete(connector_idempotency);
  await t.db.delete(connector_keys);
  await t.db.delete(connector_codes);
  await t.db.delete(user_npo_memberships);
  await t.db.delete(npos);
  await t.db.delete(user);
});

const seed_pair = async () => {
  const npo = (await seed_npo(t.db, {
    name: "Red Bird",
    registration_number: "EIN-RB",
  }))!;
  const owner = (await seed_user(t.db, "ada@test.com", "Ada", "Lovelace"))!;
  return { npo, owner };
};

const join_npo = async (npo_id: number, user_id: string) => {
  await t.db
    .insert(user_npo_memberships)
    .values({ user_id, npo_id })
    .onConflictDoNothing();
};

describe("issue_code", () => {
  test("returns a 43-char code that expires in 10 minutes and stores only its hash", async () => {
    const { npo, owner } = await seed_pair();

    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });

    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(issued.expires_at).getTime()).toBe(
      NOW.getTime() + TEN_MIN_MS
    );

    const [row] = await t.db.select().from(connector_codes);
    expect(row.code_hash).toBe(sha256_hex(issued.code));
    expect(new Date(row.expires_at).getTime()).toBe(NOW.getTime() + TEN_MIN_MS);
    expect(row.iss).toBe("https://zap.example");
    expect(row.npo_id).toBe(npo.id);
    expect(row.allowed_by).toBe(owner.id);
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toContain(issued.code);
    }
  });
});

describe("exchange_code", () => {
  test("turns a fresh code into one key and stores only its hash, prefix, and last4", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });

    const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);

    expect(exchanged).toMatchObject({
      ok: true,
      npo_id: npo.id,
      name: "Red Bird",
    });
    if (!exchanged.ok) throw new Error("fresh code did not exchange");
    expect(exchanged.key).toMatch(/^bgc_[A-Za-z0-9_-]{43}$/);

    const [row] = await t.db.select().from(connector_keys);
    expect(row.id).toBe(exchanged.key_id);
    expect(row.npo_id).toBe(npo.id);
    expect(row.allowed_by).toBe(owner.id);
    expect(row.key_hash).toBe(sha256_hex(exchanged.key));
    expect(row.prefix).toBe(exchanged.key.slice(0, 8));
    expect(row.last4).toBe(exchanged.key.slice(-4));
    expect(row.revoked_at).toBeNull();
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toContain(exchanged.key);
    }
  });

  test("a second exchange of the same code is refused and stores no second key", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const first = await exchange_code(as_db(t.db), issued.code, NOW);
    expect(first.ok).toBe(true);

    const second = await exchange_code(as_db(t.db), issued.code, NOW);

    expect(second).toEqual({ ok: false });
    const rows = await t.db.select().from(connector_keys);
    expect(rows).toHaveLength(1);
  });

  test("an expired code is refused and stores no key", async () => {
    const { npo, owner } = await seed_pair();
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const at_expiry = new Date(issued.expires_at);

    const exchanged = await exchange_code(as_db(t.db), issued.code, at_expiry);

    expect(exchanged).toEqual({ ok: false });
    expect(await t.db.select().from(connector_keys)).toHaveLength(0);
    const [code_row] = await t.db.select().from(connector_codes);
    expect(code_row.used_at).toBeNull();
  });

  test("an empty or wrong-length code is refused and writes nothing", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });

    expect(await exchange_code(as_db(t.db), "", NOW)).toEqual({ ok: false });
    expect(await exchange_code(as_db(t.db), "a".repeat(42), NOW)).toEqual({
      ok: false,
    });
    expect(await exchange_code(as_db(t.db), "a".repeat(44), NOW)).toEqual({
      ok: false,
    });

    const [code_row] = await t.db.select().from(connector_codes);
    expect(code_row.used_at).toBeNull();
    expect(await t.db.select().from(connector_keys)).toHaveLength(0);

    const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);
    expect(exchanged.ok).toBe(true);
    expect(await t.db.select().from(connector_keys)).toHaveLength(1);
  });

  test("returns ok false and leaves the code unused when the membership is gone", async () => {
    const { npo, owner } = await seed_pair();
    await t.db
      .insert(user_npo_memberships)
      .values({ user_id: owner.id, npo_id: npo.id });
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    await t.db
      .delete(user_npo_memberships)
      .where(
        and(
          eq(user_npo_memberships.user_id, owner.id),
          eq(user_npo_memberships.npo_id, npo.id)
        )
      );

    expect(await exchange_code(as_db(t.db), issued.code, NOW)).toEqual({
      ok: false,
    });

    const [row] = await t.db.select().from(connector_codes);
    expect(row.used_at).toBeNull();
    expect(await t.db.select().from(connector_keys)).toHaveLength(0);
  });

  test("share-locks the membership before inserting the key, and removal then revokes it", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    let modes: string[] = [];

    const exchanged = await exchange_code(
      as_db(t.db),
      issued.code,
      NOW,
      async (tx) => {
        const { rows } = await tx.execute<{ mode: string }>(sql`
          select l.mode
          from pg_locks l
          join pg_class c on c.oid = l.relation
          where c.relname = 'user_npo_memberships'
            and l.granted
        `);
        modes = rows.map((row) => row.mode);
        expect(await tx.select().from(connector_keys)).toHaveLength(0);
      }
    );

    expect(modes).toContain("RowShareLock");
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    expect(
      await revoke_member_keys(as_db(t.db), {
        npo_id: npo.id,
        user_id: owner.id,
        revoked_by: null,
      })
    ).toBe(1);
    expect(await find_live_key(as_db(t.db), exchanged.key, NOW)).toBeNull();
  });
});

describe("find_live_key", () => {
  test("returns the live row and null for an unknown, revoked, or non-key token", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);
    if (!exchanged.ok) throw new Error("fresh code did not exchange");

    expect(await find_live_key(as_db(t.db), exchanged.key, NOW)).toEqual({
      id: exchanged.key_id,
      npo_id: npo.id,
      allowed_by: owner.id,
    });
    expect(
      await find_live_key(as_db(t.db), `bgc_${"a".repeat(43)}`, NOW)
    ).toBeNull();
    expect(await find_live_key(as_db(t.db), "not-a-key", NOW)).toBeNull();

    await t.db
      .update(connector_keys)
      .set({ revoked_at: NOW.toISOString() })
      .where(eq(connector_keys.id, exchanged.key_id));
    expect(await find_live_key(as_db(t.db), exchanged.key, NOW)).toBeNull();
  });

  test("stamps last_used_at when it is null or older than 60s and leaves a fresher stamp", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);
    if (!exchanged.ok) throw new Error("fresh code did not exchange");

    await find_live_key(as_db(t.db), exchanged.key, NOW);
    const [first] = await t.db.select().from(connector_keys);
    expect(new Date(first.last_used_at!).getTime()).toBe(NOW.getTime());

    const older = new Date(NOW.getTime() - 61_000);
    await t.db
      .update(connector_keys)
      .set({ last_used_at: older.toISOString() })
      .where(eq(connector_keys.id, exchanged.key_id));
    await find_live_key(as_db(t.db), exchanged.key, NOW);
    const [restamped] = await t.db.select().from(connector_keys);
    expect(new Date(restamped.last_used_at!).getTime()).toBe(NOW.getTime());

    const fresh = new Date(NOW.getTime() - 30_000);
    await t.db
      .update(connector_keys)
      .set({ last_used_at: fresh.toISOString() })
      .where(eq(connector_keys.id, exchanged.key_id));
    await find_live_key(as_db(t.db), exchanged.key, NOW);
    const [kept] = await t.db.select().from(connector_keys);
    expect(new Date(kept.last_used_at!).getTime()).toBe(fresh.getTime());
  });
});

describe("revoke_key", () => {
  test("revokes a key only for its owning npo", async () => {
    const { npo, owner } = await seed_pair();
    await join_npo(npo.id, owner.id);
    const other = (await seed_npo(t.db, {
      name: "Blue Jay",
      registration_number: "EIN-BJ",
    }))!;
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);
    if (!exchanged.ok) throw new Error("fresh code did not exchange");

    expect(
      await revoke_key(as_db(t.db), {
        id: exchanged.key_id,
        npo_id: other.id,
        revoked_by: owner.id,
      })
    ).toBe(false);
    expect(await find_live_key(as_db(t.db), exchanged.key, NOW)).toEqual({
      id: exchanged.key_id,
      npo_id: npo.id,
      allowed_by: owner.id,
    });

    expect(
      await revoke_key(as_db(t.db), {
        id: exchanged.key_id,
        npo_id: npo.id,
        revoked_by: owner.id,
      })
    ).toBe(true);
    expect(await find_live_key(as_db(t.db), exchanged.key, NOW)).toBeNull();
  });
});

const mint = async (npo_id: number, allowed_by: string) => {
  await join_npo(npo_id, allowed_by);
  const issued = await issue_code(as_db(t.db), {
    npo_id,
    allowed_by,
    iss: "https://zap.example",
    now: NOW,
  });
  const exchanged = await exchange_code(as_db(t.db), issued.code, NOW);
  if (!exchanged.ok) throw new Error("fresh code did not exchange");
  return exchanged;
};

describe("revoke_member_keys", () => {
  test("revokes only that user's live keys for that npo", async () => {
    const { npo, owner } = await seed_pair();
    const other_npo = (await seed_npo(t.db, {
      name: "Blue Jay",
      registration_number: "EIN-BJ",
    }))!;
    const other = (await seed_user(t.db, "grace@test.com", "Grace", "Hopper"))!;
    const ada_here = await mint(npo.id, owner.id);
    const ada_there = await mint(other_npo.id, owner.id);
    const grace_here = await mint(npo.id, other.id);

    const n = await t.db.transaction((tx) =>
      revoke_member_keys(as_db(tx), {
        npo_id: npo.id,
        user_id: owner.id,
        revoked_by: other.id,
      })
    );

    expect(n).toBe(1);
    expect(await find_live_key(as_db(t.db), ada_here.key, NOW)).toBeNull();
    expect(await find_live_key(as_db(t.db), ada_there.key, NOW)).toMatchObject({
      id: ada_there.key_id,
      npo_id: other_npo.id,
      allowed_by: owner.id,
    });
    expect(await find_live_key(as_db(t.db), grace_here.key, NOW)).toMatchObject(
      {
        id: grace_here.key_id,
        npo_id: npo.id,
        allowed_by: other.id,
      }
    );
    const [revoked] = await t.db
      .select()
      .from(connector_keys)
      .where(eq(connector_keys.id, ada_here.key_id));
    expect(revoked.revoked_by).toBe(other.id);
    expect(revoked.revoked_at).not.toBeNull();
  });

  test("deletes that user's unused code for that npo and leaves another user's", async () => {
    const { npo, owner } = await seed_pair();
    const other_npo = (await seed_npo(t.db, {
      name: "Blue Jay",
      registration_number: "EIN-BJ",
    }))!;
    const other = (await seed_user(t.db, "grace@test.com", "Grace", "Hopper"))!;
    const ada_unused = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const ada_used = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    await t.db
      .update(connector_codes)
      .set({ used_at: NOW.toISOString() })
      .where(eq(connector_codes.code_hash, sha256_hex(ada_used.code)));
    const ada_elsewhere = await issue_code(as_db(t.db), {
      npo_id: other_npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
      now: NOW,
    });
    const grace_unused = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: other.id,
      iss: "https://zap.example",
      now: NOW,
    });

    await revoke_member_keys(as_db(t.db), {
      npo_id: npo.id,
      user_id: owner.id,
      revoked_by: other.id,
    });

    const left = (
      await t.db
        .select({ code_hash: connector_codes.code_hash })
        .from(connector_codes)
    ).map((row) => row.code_hash);
    expect(left).not.toContain(sha256_hex(ada_unused.code));
    expect(left.sort()).toEqual(
      [
        sha256_hex(ada_used.code),
        sha256_hex(ada_elsewhere.code),
        sha256_hex(grace_unused.code),
      ].sort()
    );
  });

  test("a rolled-back transaction leaves the member's keys live", async () => {
    const { npo, owner } = await seed_pair();
    const other = (await seed_user(t.db, "grace@test.com", "Grace", "Hopper"))!;
    const ada_here = await mint(npo.id, owner.id);
    let revoked = -1;

    await expect(
      t.db.transaction(async (tx) => {
        revoked = await revoke_member_keys(as_db(tx), {
          npo_id: npo.id,
          user_id: owner.id,
          revoked_by: other.id,
        });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    expect(revoked).toBe(1);
    expect(await find_live_key(as_db(t.db), ada_here.key, NOW)).toEqual({
      id: ada_here.key_id,
      npo_id: npo.id,
      allowed_by: owner.id,
    });
  });
});

describe("list_live_keys", () => {
  test("returns live keys newest first with the allowing user's name", async () => {
    const { npo, owner } = await seed_pair();
    const other_npo = (await seed_npo(t.db, {
      name: "Blue Jay",
      registration_number: "EIN-BJ",
    }))!;
    const other = (await seed_user(t.db, "grace@test.com", "Grace", "Hopper"))!;
    await t.db.insert(connector_keys).values([
      {
        id: "key-old",
        npo_id: npo.id,
        key_hash: sha256_hex("old"),
        prefix: "bgc_old1",
        last4: "old1",
        allowed_by: owner.id,
        created_at: "2026-10-01T00:00:00.000Z",
        last_used_at: "2026-10-02T00:00:00.000Z",
      },
      {
        id: "key-new",
        npo_id: npo.id,
        key_hash: sha256_hex("new"),
        prefix: "bgc_new1",
        last4: "new1",
        allowed_by: other.id,
        created_at: "2026-10-03T00:00:00.000Z",
      },
      {
        id: "key-revoked",
        npo_id: npo.id,
        key_hash: sha256_hex("revoked"),
        prefix: "bgc_rev1",
        last4: "rev1",
        allowed_by: owner.id,
        created_at: "2026-10-05T00:00:00.000Z",
        revoked_at: "2026-10-04T00:00:00.000Z",
        revoked_by: other.id,
      },
      {
        id: "key-elsewhere",
        npo_id: other_npo.id,
        key_hash: sha256_hex("elsewhere"),
        prefix: "bgc_els1",
        last4: "els1",
        allowed_by: owner.id,
        created_at: "2026-10-06T00:00:00.000Z",
      },
    ]);

    const rows = await list_live_keys(as_db(t.db), npo.id);

    expect(rows).toEqual([
      {
        id: "key-new",
        prefix: "bgc_new1",
        last4: "new1",
        allowed_by: other.id,
        allowed_by_name: "Grace Hopper",
        created_at: "2026-10-03T00:00:00.000Z",
        last_used_at: null,
      },
      {
        id: "key-old",
        prefix: "bgc_old1",
        last4: "old1",
        allowed_by: owner.id,
        allowed_by_name: "Ada Lovelace",
        created_at: "2026-10-01T00:00:00.000Z",
        last_used_at: "2026-10-02T00:00:00.000Z",
      },
    ]);
  });
});

const days_before = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("sweep", () => {
  test("revokes keys idle 90 days, deletes expired codes, and drops idempotency older than 24h", async () => {
    const { npo, owner } = await seed_pair();
    await t.db.insert(connector_keys).values([
      {
        id: "key-idle",
        npo_id: npo.id,
        key_hash: sha256_hex("idle"),
        prefix: "bgc_idle",
        last4: "idle",
        allowed_by: owner.id,
        created_at: days_before(91),
      },
      {
        id: "key-recent",
        npo_id: npo.id,
        key_hash: sha256_hex("recent"),
        prefix: "bgc_rcnt",
        last4: "rcnt",
        allowed_by: owner.id,
        created_at: days_before(200),
        last_used_at: days_before(1),
      },
    ]);
    await t.db.insert(connector_codes).values([
      {
        code_hash: sha256_hex("expired-code"),
        npo_id: npo.id,
        allowed_by: owner.id,
        iss: "https://zap.example",
        expires_at: new Date(NOW.getTime() - 1000).toISOString(),
      },
      {
        code_hash: sha256_hex("live-code"),
        npo_id: npo.id,
        allowed_by: owner.id,
        iss: "https://zap.example",
        expires_at: new Date(NOW.getTime() + TEN_MIN_MS).toISOString(),
      },
    ]);
    await t.db.insert(connector_idempotency).values([
      {
        key_id: "key-recent",
        idem_key: "old-request",
        request_hash: sha256_hex("old-request"),
        status: "pending",
        created_at: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
      },
      {
        key_id: "key-recent",
        idem_key: "fresh-request",
        request_hash: sha256_hex("fresh-request"),
        status: "pending",
        created_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      },
    ]);

    expect(await sweep(as_db(t.db), NOW)).toEqual({
      keys_revoked: 1,
      codes_deleted: 1,
      idempotency_deleted: 1,
      photo_links_deleted: 0,
    });

    const keys = await t.db.select().from(connector_keys);
    const idle = keys.find((row) => row.id === "key-idle");
    const recent = keys.find((row) => row.id === "key-recent");
    expect(idle?.revoked_by).toBeNull();
    expect(new Date(idle!.revoked_at!).getTime()).toBe(NOW.getTime());
    expect(recent?.revoked_at).toBeNull();

    const codes = await t.db.select().from(connector_codes);
    expect(codes.map((row) => row.code_hash)).toEqual([
      sha256_hex("live-code"),
    ]);

    const idem = await t.db.select().from(connector_idempotency);
    expect(idem.map((row) => row.idem_key)).toEqual(["fresh-request"]);
  });
});

describe("connector_keys key_hash", () => {
  test("a second key with the same key_hash is rejected", async () => {
    const { npo, owner } = await seed_pair();
    const shared = {
      npo_id: npo.id,
      key_hash: sha256_hex("same-key"),
      prefix: "bgc_same",
      last4: "same",
      allowed_by: owner.id,
    };
    await t.db.insert(connector_keys).values({ id: "key-a", ...shared });

    await expect(
      t.db.insert(connector_keys).values({ id: "key-b", ...shared })
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const rows = await t.db.select().from(connector_keys);
    expect(rows.map((row) => row.id)).toEqual(["key-a"]);
  });

  test("rejects a key_hash that is not 64 lowercase hex characters", async () => {
    const { npo, owner } = await seed_pair();
    await expect(
      t.db.insert(connector_keys).values({
        id: "key-raw",
        npo_id: npo.id,
        key_hash: `bgc_${"a".repeat(43)}`,
        prefix: "bgc_aaaa",
        last4: "aaaa",
        allowed_by: owner.id,
      })
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await t.db.select().from(connector_keys)).toHaveLength(0);
  });
});

describe("connector_idempotency response", () => {
  test("pending rows have no response and stored rows have both parts", async () => {
    const { npo, owner } = await seed_pair();
    await t.db.insert(connector_keys).values({
      id: "key-idem",
      npo_id: npo.id,
      key_hash: sha256_hex("idem"),
      prefix: "bgc_idem",
      last4: "idem",
      allowed_by: owner.id,
    });
    const base = {
      key_id: "key-idem",
      request_hash: sha256_hex("body"),
    };

    await expect(
      t.db.insert(connector_idempotency).values({
        ...base,
        idem_key: "pending-with-body",
        status: "pending",
        response_status: 200,
        response_body: { ok: true },
      })
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      t.db.insert(connector_idempotency).values({
        ...base,
        idem_key: "stored-without-body",
        status: "stored",
      })
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await t.db.insert(connector_idempotency).values([
      { ...base, idem_key: "pending-ok", status: "pending" },
      {
        ...base,
        idem_key: "stored-ok",
        status: "stored",
        response_status: 201,
        response_body: { id: "don_1" },
      },
    ]);
    const rows = await t.db
      .select({ idem_key: connector_idempotency.idem_key })
      .from(connector_idempotency);
    expect(rows.map((row) => row.idem_key).sort()).toEqual([
      "pending-ok",
      "stored-ok",
    ]);
  });
});
