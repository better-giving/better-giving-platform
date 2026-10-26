import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
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
  IDEMPOTENCY_PENDING_RECLAIM_MS,
  with_idempotency,
} from "./idempotency";
import { exchange_code, issue_code } from "./keys";

const as_db = (x: unknown) => x as DbOrTx;
const HASH_OF_EMPTY = createHash("sha256").update("{}", "utf8").digest("hex");

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

const seed_key = async () => {
  const npo = (await seed_npo(t.db, {
    name: "Red Bird",
    registration_number: "EIN-RB",
  }))!;
  const owner = (await seed_user(t.db, "ada@test.com", "Ada", "Lovelace"))!;
  await t.db
    .insert(user_npo_memberships)
    .values({ user_id: owner.id, npo_id: npo.id });
  const issued = await issue_code(as_db(t.db), {
    npo_id: npo.id,
    allowed_by: owner.id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(t.db), issued.code);
  if (!exchanged.ok) throw new Error("seed key failed");
  return exchanged.key_id;
};

const call = (
  key_id: string,
  idem: string | undefined,
  body: string,
  handler: (resource_id: string) => Promise<Response>
) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (idem !== undefined) headers.set("Idempotency-Key", idem);
  const request = new Request("https://bg.test/connector/v1/x", {
    method: "POST",
    headers,
    body,
  });
  return with_idempotency(as_db(t.db), key_id, request, handler);
};

describe("with_idempotency", () => {
  test.each([
    ["missing", undefined],
    ["blank", "   "],
    ["longer than 255", "k".repeat(256)],
  ])("%s key is 400 and does not call the handler", async (_label, idem) => {
    const key_id = await seed_key();
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const res = await call(key_id, idem, "{}", handler);

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      code: "idempotency_key_required",
      status: 400,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(await t.db.select().from(connector_idempotency)).toHaveLength(0);
  });

  test("the first call stores 201 and a repeat of the same body within 24h is 200", async () => {
    const key_id = await seed_key();
    const body = '{"n":1}';
    const handler = vi.fn(async () => Response.json({ n: 1 }, { status: 201 }));
    const idem = "k".repeat(255);

    const first = await call(key_id, idem, body, handler);

    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ n: 1 });
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.status).toBe("stored");
    expect(row.response_status).toBe(201);
    expect(row.response_body).toEqual({ n: 1 });
    expect(row.idem_key).toBe(idem);

    const again = await call(key_id, idem, body, handler);

    expect(again.status).toBe(200);
    expect(again.headers.get("cache-control")).toBe("no-store");
    expect(await again.json()).toEqual({ n: 1 });
    expect(handler).toHaveBeenCalledOnce();
    expect(await t.db.select().from(connector_idempotency)).toHaveLength(1);
  });

  test("the same key with a different raw body is 409 and does not call the handler again", async () => {
    const key_id = await seed_key();
    const handler = vi.fn(async () => Response.json({ n: 1 }, { status: 201 }));

    expect((await call(key_id, "same", '{"n":1}', handler)).status).toBe(201);

    const res = await call(key_id, "same", '{ "n": 1 }', handler);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "idempotency_conflict",
      status: 409,
      detail: expect.stringMatching(/already used for a different request/),
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  test("a fresh pending row of the same body is in progress: 409 with Retry-After, and the handler does not run", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "flight",
      request_hash: HASH_OF_EMPTY,
      status: "pending",
    });
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const res = await call(key_id, "flight", "{}", handler);

    expect(res.status).toBe(409);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("idempotency_in_progress");
    expect(body.detail).toMatch(/same Idempotency-Key and the same body/);
    expect(handler).not.toHaveBeenCalled();
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.status).toBe("pending");
  });

  test("a pending row of a different body is a conflict, not in progress", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "flight",
      request_hash: "a".repeat(64),
      status: "pending",
    });
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const res = await call(key_id, "flight", "{}", handler);

    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBeNull();
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("idempotency_conflict");
    expect(body.detail).toMatch(/already used for a different request/);
    expect(handler).not.toHaveBeenCalled();
  });

  test("a pending row past the reclaim window is taken over: the handler runs once and its answer is stored", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "dead",
      request_hash: HASH_OF_EMPTY,
      status: "pending",
      created_at: new Date(
        Date.now() - IDEMPOTENCY_PENDING_RECLAIM_MS - 5_000
      ).toISOString(),
      resource_id: "first-attempt-id",
    });
    const handler = vi.fn(async (_id: string) =>
      Response.json({ made: 1 }, { status: 201 })
    );

    const res = await call(key_id, "dead", "{}", handler);

    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledExactlyOnceWith("first-attempt-id");
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.status).toBe("stored");
    expect(row.response_body).toEqual({ made: 1 });
    expect(row.resource_id).toBe("first-attempt-id");
  });

  test("two retries of a dead pending row: only one takes it over, the other is in progress", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "dead",
      request_hash: HASH_OF_EMPTY,
      status: "pending",
      created_at: new Date(
        Date.now() - IDEMPOTENCY_PENDING_RECLAIM_MS - 5_000
      ).toISOString(),
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const handler = vi.fn(async () => {
      await gate;
      return Response.json({ made: 1 }, { status: 201 });
    });

    const first = call(key_id, "dead", "{}", handler);
    const second = call(key_id, "dead", "{}", handler);
    const loser = await Promise.race([first, second]);
    release();
    const statuses = [(await first).status, (await second).status].sort();

    expect(loser.status).toBe(409);
    expect(((await loser.json()) as { code: string }).code).toBe(
      "idempotency_in_progress"
    );
    expect(statuses).toEqual([201, 409]);
    expect(handler).toHaveBeenCalledOnce();
  });

  test("a pending row just inside the reclaim window is not taken over", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "slow",
      request_hash: HASH_OF_EMPTY,
      status: "pending",
      created_at: new Date(
        Date.now() - IDEMPOTENCY_PENDING_RECLAIM_MS + 5_000
      ).toISOString(),
    });
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const res = await call(key_id, "slow", "{}", handler);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "idempotency_in_progress"
    );
    expect(handler).not.toHaveBeenCalled();
  });

  test("the same header on a different key id runs the handler and stores a second row", async () => {
    const key_id = await seed_key();
    const npo = (await seed_npo(t.db, {
      name: "Blue Bird",
      registration_number: "EIN-BB",
    }))!;
    const owner = (await seed_user(t.db, "bea@test.com", "Bea", "Lovelace"))!;
    await t.db
      .insert(user_npo_memberships)
      .values({ user_id: owner.id, npo_id: npo.id });
    const issued = await issue_code(as_db(t.db), {
      npo_id: npo.id,
      allowed_by: owner.id,
      iss: "https://zap.example",
    });
    const second = await exchange_code(as_db(t.db), issued.code);
    if (!second.ok) throw new Error("second seed key failed");
    const handler = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 })
    );

    expect((await call(key_id, "shared", "{}", handler)).status).toBe(201);
    expect((await call(second.key_id, "shared", "{}", handler)).status).toBe(
      201
    );

    expect(handler).toHaveBeenCalledTimes(2);
    const rows = await t.db.select().from(connector_idempotency);
    expect(rows.map((row) => row.key_id).sort()).toEqual(
      [key_id, second.key_id].sort()
    );
  });

  test("a stored row older than 24h can be used again", async () => {
    const key_id = await seed_key();
    await t.db.insert(connector_idempotency).values({
      key_id,
      idem_key: "stale",
      request_hash: "b".repeat(64),
      status: "stored",
      response_status: 201,
      response_body: { stale: true },
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      resource_id: "stale-id",
    });
    const handler = vi.fn(async (_id: string) =>
      Response.json({ fresh: true }, { status: 201 })
    );

    const res = await call(key_id, "stale", '{"fresh":true}', handler);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fresh: true });
    expect(handler).toHaveBeenCalledOnce();
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.resource_id).not.toBe("stale-id");
    expect(handler).toHaveBeenCalledWith(row.resource_id);
    expect(row.response_body).toEqual({ fresh: true });
    expect(row.status).toBe("stored");
    expect(Date.parse(row.created_at)).toBeGreaterThan(Date.now() - 60_000);
  });

  const age_claim = () =>
    t.db.update(connector_idempotency).set({
      created_at: new Date(
        Date.now() - IDEMPOTENCY_PENDING_RECLAIM_MS - 1_000
      ).toISOString(),
    });

  test("a handler throw keeps the pending row: a retry inside the window is in progress, past it the retry gets the same resource id", async () => {
    const key_id = await seed_key();
    const boom = vi.fn(async (_id: string): Promise<Response> => {
      throw new Error("nope");
    });

    await expect(call(key_id, "once", "{}", boom)).rejects.toThrow("nope");
    const [claim] = await t.db.select().from(connector_idempotency);
    expect(claim.status).toBe("pending");
    expect(boom).toHaveBeenCalledExactlyOnceWith(claim.resource_id);

    const handler = vi.fn(async (_id: string) =>
      Response.json({ ok: true }, { status: 201 })
    );
    const early = await call(key_id, "once", "{}", handler);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { code: string }).code).toBe(
      "idempotency_in_progress"
    );
    expect(handler).not.toHaveBeenCalled();

    await age_claim();
    const res = await call(key_id, "once", "{}", handler);

    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledExactlyOnceWith(claim.resource_id);
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.status).toBe("stored");
    expect(row.resource_id).toBe(claim.resource_id);
  });

  test("a 5xx is returned unchanged and keeps the pending row, so the reclaim reruns with the same resource id", async () => {
    const key_id = await seed_key();
    const failed = vi.fn(
      async (_id: string) =>
        new Response(JSON.stringify({ code: "write_failed", status: 500 }), {
          status: 500,
          headers: { "content-type": "application/problem+json" },
        })
    );

    const res = await call(key_id, "lost", "{}", failed);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "write_failed", status: 500 });
    const [claim] = await t.db.select().from(connector_idempotency);
    expect(claim.status).toBe("pending");
    expect(claim.response_status).toBeNull();

    const handler = vi.fn(async (_id: string) =>
      Response.json({ ok: true }, { status: 201 })
    );
    expect((await call(key_id, "lost", "{}", handler)).status).toBe(409);
    expect(handler).not.toHaveBeenCalled();

    await age_claim();
    expect((await call(key_id, "lost", "{}", handler)).status).toBe(201);
    expect(failed).toHaveBeenCalledExactlyOnceWith(claim.resource_id);
    expect(handler).toHaveBeenCalledExactlyOnceWith(claim.resource_id);
  });

  test("a 4xx is returned unchanged and frees the key at once", async () => {
    const key_id = await seed_key();
    const handler = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "invalid", status: 422 }), {
          status: 422,
          headers: { "content-type": "application/problem+json" },
        })
    );

    const res = await call(key_id, "bad", "{}", handler);

    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "invalid", status: 422 });
    expect(await t.db.select().from(connector_idempotency)).toHaveLength(0);

    const again = await call(key_id, "bad", "{}", handler);
    expect(again.status).toBe(422);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("a 2xx body that is not json keeps the pending row, so a retry inside the window is in progress", async () => {
    const key_id = await seed_key();
    const handler = vi.fn(async () => new Response("", { status: 201 }));

    await expect(call(key_id, "empty", "{}", handler)).rejects.toThrow();
    const [row] = await t.db.select().from(connector_idempotency);
    expect(row.status).toBe("pending");
    expect(row.response_status).toBeNull();

    const retry = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 })
    );
    const res = await call(key_id, "empty", "{}", retry);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "idempotency_in_progress"
    );
    expect(retry).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });
});
