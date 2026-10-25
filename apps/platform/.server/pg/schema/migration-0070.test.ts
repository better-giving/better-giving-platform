import { afterAll, beforeAll, expect, test } from "vitest";
import {
  create_test_db,
  seed_npo_sql,
  type TestDb,
} from "../test-utils/pglite";
import { user } from "./auth";
import { campaigns } from "./campaign";
import { funds } from "./fund";

// 0070 folds org funds into campaigns: a nullable, unique `legacy_fund_id`
// pointing at the fund a campaign was migrated from.
let t: TestDb;
let npo: number;

beforeAll(async () => {
  t = await create_test_db();
  npo = await seed_npo_sql(t.client, "EIN-0070");
  await t.db.insert(user).values({
    id: "u-0070",
    name: "U",
    email: "u-0070@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "U",
    last_name: "U",
  });
  await t.db.insert(funds).values({
    id: "fund-0070",
    name: "Fund",
    slug: "fund-0070",
    description_pt: "[]",
    banner: "b",
    logo: "l",
    creator_id: "u-0070",
    npo_owner: npo,
  });
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

test("a campaign may carry no legacy_fund_id", async () => {
  await t.db.insert(campaigns).values({
    id: "c-none",
    owner_npo_id: npo,
    creator_id: "u-0070",
    name: "No fund",
    slug: "c-none",
  });
  const [row] = await t.db.select().from(campaigns);
  expect(row?.legacy_fund_id).toBeNull();
});

test("legacy_fund_id is unique: two campaigns cannot fold the same fund", async () => {
  await t.db.insert(campaigns).values({
    id: "c-a",
    owner_npo_id: npo,
    creator_id: "u-0070",
    name: "A",
    slug: "c-a",
    legacy_fund_id: "fund-0070",
  });
  await expect(
    t.db.insert(campaigns).values({
      id: "c-b",
      owner_npo_id: npo,
      creator_id: "u-0070",
      name: "B",
      slug: "c-b",
      legacy_fund_id: "fund-0070",
    })
  ).rejects.toThrow();
});
