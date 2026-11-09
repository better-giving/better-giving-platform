import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seed_npo } from "#/__tests__/fixtures/funds";
import { npos } from "../pg/schema/npo";
import type { TestDb } from "../pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const flags = vi.hoisted(() => ({ routing: true }));
const retrieve = vi.hoisted(() => vi.fn());

vi.mock("../pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));
vi.mock("../kit/stripe", () => ({ stripe: { transfers: { retrieve } } }));
vi.mock("#/errors/report", () => ({ report_degraded: vi.fn() }));
vi.mock("../env", async (importOriginal) => {
  const real = await importOriginal<typeof import("../env")>();
  return {
    ...real,
    stripe: {
      ...real.stripe,
      get connect_routing() {
        return flags.routing;
      },
    },
  };
});

import { dists } from "../pg/schema/dist";
import { donations } from "../pg/schema/donation";
import { create_test_db } from "../pg/test-utils/pglite";
import { npo_sent_transfers } from "./sent";

const db = () => test_db.current!.db;

/** linked, ready, unsponsored, in a transfer country */
const ROUTABLE = {
  registration_number: "EIN-SENT-ON",
  hq_country: "United States",
  stripe_account_id: "acct_on",
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  stripe_details_submitted: true,
  stripe_requirements_due: [],
} satisfies Partial<typeof npos.$inferInsert>;

const seed = async (o: Partial<typeof npos.$inferInsert> = {}) =>
  (await seed_npo(db(), { ...ROUTABLE, ...o }))!.id;

async function sent_one(npo_id: number) {
  const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
  retrieve.mockResolvedValue({
    id: "tr_past",
    amount: 9_000,
    amount_reversed: 0,
    created,
    reversals: { data: [], has_more: false },
  });
  await db().insert(donations).values({
    id: "don-past",
    upusd: 1,
    status: "settled",
    amount_base: 90,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db().insert(dists).values({
    id: "dist-past",
    donation_id: "don-past",
    status: "settled",
    date_created: "2026-07-01T00:00:00.000Z",
    to_id: npo_id,
    amount_denom: "USD",
    net: 90,
    stripe_routed_to: "acct_on",
    stripe_transfer_id: "tr_past",
    stripe_transfer_created_at: "2026-07-01T00:00:00.000Z",
  });
}

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  flags.routing = true;
  retrieve.mockReset();
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
});

describe("npo_sent_transfers — on stripe", () => {
  test("a routable nonprofit with nothing sent is on stripe", async () => {
    const id = await seed();
    expect(await npo_sent_transfers(id)).toEqual({
      items: [],
      truncated: false,
      on_stripe: true,
      connected: true,
    });
  });

  test("a fiscally sponsored nonprofit with a linked account is connected off stripe", async () => {
    const id = await seed({ fiscal_sponsored: true });
    expect(await npo_sent_transfers(id)).toMatchObject({
      items: [],
      on_stripe: false,
      connected: true,
    });
  });

  test("a nonprofit with no account linked and nothing sent is not on stripe", async () => {
    const id = await seed({ stripe_account_id: null });
    expect(await npo_sent_transfers(id)).toBeNull();
  });

  test("a disconnected nonprofit with nothing sent is not on stripe", async () => {
    const id = await seed({
      stripe_deauthorized_at: "2026-08-01T00:00:00.000Z",
    });
    expect(await npo_sent_transfers(id)).toBeNull();
  });

  test.each([
    ["pending review", { stripe_charges_enabled: false }],
    ["incomplete", { stripe_details_submitted: false }],
  ])(
    "a linked nonprofit whose account is %s, with nothing sent, is connected off stripe",
    async (_, not_ready) => {
      const id = await seed(not_ready);
      expect(await npo_sent_transfers(id)).toEqual({
        items: [],
        truncated: false,
        on_stripe: false,
        connected: true,
      });
    }
  );

  test("a linked nonprofit whose account is not ready keeps its past transfers, off stripe", async () => {
    const id = await seed({ stripe_details_submitted: false });
    await sent_one(id);
    const sent = await npo_sent_transfers(id);
    expect(sent?.items.map((t) => t.id)).toEqual(["tr_past"]);
    expect(sent).toMatchObject({ on_stripe: false, connected: true });
  });

  test("with the routing switch off nothing is on stripe", async () => {
    flags.routing = false;
    const id = await seed();
    expect(await npo_sent_transfers(id)).toBeNull();
  });

  test("an ineligible nonprofit keeps its past transfers, off stripe", async () => {
    const id = await seed({ fiscal_sponsored: true });
    await sent_one(id);
    const sent = await npo_sent_transfers(id);
    expect(sent?.items.map((t) => t.id)).toEqual(["tr_past"]);
    expect(sent).toMatchObject({ on_stripe: false, connected: true });
  });

  test("a disconnected nonprofit keeps its past transfers, not connected", async () => {
    const id = await seed({
      stripe_deauthorized_at: "2026-08-01T00:00:00.000Z",
    });
    await sent_one(id);
    const sent = await npo_sent_transfers(id);
    expect(sent?.items.map((t) => t.id)).toEqual(["tr_past"]);
    expect(sent).toMatchObject({ on_stripe: false, connected: false });
  });
});
