import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const deductions = vi.hoisted(() => ({ on: false }));

vi.mock("$/pg/db", () => ({
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
vi.mock("$/kit/stripe", () => ({ stripe: {} }));
vi.mock("$/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("$/env")>();
  return {
    ...real,
    stripe: { ...real.stripe, connect_routing: true },
    get owed_deductions() {
      return deductions.on;
    },
  };
});
// terms posted before every gift here, so a row a run may net once its notice
// is sent
vi.mock("@/terms", async (io) => ({
  ...(await io<typeof import("@/terms")>()),
  TERMS_RECOVERY_FROM: "2026-01-01",
  TERMS_POSTED: "",
}));
vi.mock("#/errors/report", () => ({ report_degraded: vi.fn() }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

import { seed_npo } from "#/__tests__/fixtures/funds";
import { seed_held, seed_owed } from "#/__tests__/fixtures/owed";
import { admin_ctx } from "$/auth/test-utils";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import { owed_amounts, owed_notices } from "$/pg/schema/owed";
import { payouts } from "$/pg/schema/payout";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";

const db = () => test_db.current!.db;
let npo_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  deductions.on = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:00:00.000Z"));
  await db().delete(owed_notices);
  await db().delete(owed_amounts);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
  // stripe disconnected by the npo, no bank: stripe stands in for one, so
  // the loader reads what is held
  const row = await seed_npo(db(), {
    registration_number: "EIN-BANK-LOADER",
    stripe_account_id: "acct_gone",
    stripe_deauthorized_at: "2026-09-01T00:00:00.000Z",
  });
  npo_id = row!.id;
});

afterEach(() => {
  vi.useRealTimers();
});

async function load() {
  return loader({
    ...doc_args(new Request(`https://app.test/admin/${npo_id}/banking`)),
    context: { get: (k: unknown) => (k === admin_ctx ? npo_id : undefined) },
  } as any);
}

describe("banking loader — held money", () => {
  test("the held card is net of what the npo owes", async () => {
    deductions.on = true;
    await seed_held(db(), npo_id, 100);
    await seed_owed(db(), npo_id, 30.5);

    const data = await load();

    expect(data.held?.total).toBe(100);
    expect(data.held?.net).toBe(69.5);
  });
});
