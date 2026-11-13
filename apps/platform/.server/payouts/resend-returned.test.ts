import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TestDb } from "../pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("../pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const { resend_returned } = await import("./resend-returned");
const { bapp_approve, bapp_set_default } = await import(
  "../pg/queries/banking"
);
const { banking_apps } = await import("../pg/schema/banking");
const { npos } = await import("../pg/schema/npo");
const { payouts, settlements } = await import("../pg/schema/payout");
const { create_test_db } = await import("../pg/test-utils/pglite");

const db = () => test_db.current!.db;

/** the returned transfer went out before every approval below */
const SENT = "2026-11-01T00:00:00.000Z";

let npo_id: number;
let other_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const npo = (registration_number: string) => ({
  registration_number,
  name: registration_number,
  endow_designation: "Charity" as const,
  overview_pt: "[]",
  hq_country: "United States",
});

beforeEach(async () => {
  await db().delete(payouts);
  await db().delete(settlements);
  await db().delete(npos);
  const [a, b] = await db()
    .insert(npos)
    .values([npo("EIN-RESEND"), npo("EIN-OTHER")])
    .returning();
  npo_id = a!.id;
  other_id = b!.id;
});

/** a payout of a run whose transfer came back, for `npo` */
async function seed_returned(id: string, npo = npo_id) {
  const sttl = `sttl-${npo}`;
  await db()
    .insert(settlements)
    .values({
      id: sttl,
      other_id: `ref-${npo}`,
      npo_id: npo,
      date: SENT,
      amount: 100,
      status: "returned",
    })
    .onConflictDoNothing();
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id: npo,
      source: "donation",
      date: "2026-10-01T00:00:00.000Z",
      amount: 100,
      type: "returned",
      settled_id: sttl,
      settled_date: SENT,
    });
}

async function seed_bapp(
  id: string,
  status: "default" | "approved" | "under-review",
  updated_at = "2026-06-01T00:00:00.000Z"
) {
  await db()
    .insert(banking_apps)
    .values({ id, npo_id, status, date_created: updated_at, updated_at });
}

const rows = async () =>
  Object.fromEntries(
    (await db().select().from(payouts)).map((p) => [
      p.id,
      [p.type, p.settled_id, p.settled_date],
    ])
  );

describe("resend_returned", () => {
  test("an npo's first approved account takes its returned payouts back to pending, with no settlement on them", async () => {
    await seed_returned("p-1");
    await seed_returned("p-2");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    const res = await resend_returned(npo_id);

    expect(res).toEqual({ status: "resent", ids: ["p-1", "p-2"] });
    expect(await rows()).toEqual({
      "p-1": ["pending", null, null],
      "p-2": ["pending", null, null],
    });
  });

  test("a second call resends nothing", async () => {
    await seed_returned("p-1");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);
    await resend_returned(npo_id);

    expect(await resend_returned(npo_id)).toEqual({ status: "none" });
    expect((await rows())["p-1"]?.[0]).toBe("pending");
  });

  test("only the npo's returned payouts move", async () => {
    await seed_returned("p-1");
    await seed_returned("p-other", other_id);
    await db()
      .insert(payouts)
      .values({
        id: "p-settled",
        source_id: "dist-settled",
        npo_id,
        source: "donation",
        date: "2026-10-01T00:00:00.000Z",
        amount: 5,
        type: "settled",
        settled_id: `sttl-${npo_id}`,
        settled_date: SENT,
      });
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    await resend_returned(npo_id);

    const r = await rows();
    expect([r["p-1"]?.[0], r["p-other"]?.[0], r["p-settled"]?.[0]]).toEqual([
      "pending",
      "returned",
      "settled",
    ]);
  });

  test("an account approved beside the default the transfer bounced from holds them, until it is made the default", async () => {
    await seed_returned("p-1");
    await seed_bapp("old", "default");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    expect(await resend_returned(npo_id)).toEqual({
      status: "held",
      reason: "the default account predates the returned transfer",
    });
    expect((await rows())["p-1"]?.[0]).toBe("returned");

    await bapp_set_default("new", npo_id);

    expect(await resend_returned(npo_id)).toEqual({
      status: "resent",
      ids: ["p-1"],
    });
  });

  test("an npo with no account to pay keeps them returned", async () => {
    await seed_returned("p-1");
    await seed_bapp("new", "under-review");

    expect(await resend_returned(npo_id)).toEqual({
      status: "held",
      reason: "no approved account",
    });
  });
});
