import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TStatus } from "@/reg/schema";
import type { DbOrTx } from "../pg/queries/helpers";
import { npos } from "../pg/schema/npo";
import { registrations } from "../pg/schema/registration";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";

// held_elsewhere reads through the handle it is given; the module's own db is never reached
vi.mock("../pg/db", () => ({ db: {} }));

const { held_elsewhere } = await import("./target");

// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as DbOrTx;

let test_db: TestDb;

beforeAll(async () => {
  test_db = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  await test_db.db.delete(registrations);
  await test_db.db.delete(npos);
});

const ACCT = "acct_shared";
const ASKING = { kind: "reg", reg_id: "r-new" } as const;

const seed_reg = (id: string, status: TStatus, acct = ACCT) =>
  test_db.db.insert(registrations).values({
    id,
    r_id: `${id}@test.com`,
    status,
    o_stripe_account_id: acct,
  });

const seed_npo_on = (acct: string) =>
  test_db.db.insert(npos).values({
    registration_number: "EIN-HELD",
    name: "Held NPO",
    endow_designation: "Charity",
    overview_pt: "[]",
    hq_country: "United States",
    published: false,
    active: true,
    stripe_account_id: acct,
  });

const held = () => held_elsewhere(ACCT, ASKING, as_db(test_db.db));

test("a rejected registration's account is free to connect from a new one", async () => {
  await seed_reg("r-rejected", "04");
  expect(await held()).toBe(false);
});

test("a registration in review still holds its account", async () => {
  await seed_reg("r-review", "02");
  expect(await held()).toBe(true);
});

test("an approved nonprofit holds its account", async () => {
  await seed_npo_on(ACCT);
  expect(await held()).toBe(true);
});

test("a rejected registration does not free an account a nonprofit holds", async () => {
  await seed_reg("r-rejected", "04");
  await seed_npo_on(ACCT);
  expect(await held()).toBe(true);
});

test("a registration does not hold its own account against itself", async () => {
  await seed_reg(ASKING.reg_id, "01");
  expect(await held()).toBe(false);
});
