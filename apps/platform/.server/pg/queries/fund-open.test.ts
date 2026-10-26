import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

// the queries read the module-level handle rather than taking one, so the
// pglite db is swapped in behind it.
vi.mock("../db", () => ({
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

import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { fund_closes_at, fund_is_open } from "@/campaign/is-open";
import { fund_members, funds } from "../schema/fund";
import { npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import { fund_npo_memberof, fund_search } from "./fund";

const OCT_1 = "2026-10-01T00:00:00Z";
// from the ts rule, so the sql rule drifting from it fails this suite
const CLOSES_AT = fund_closes_at(OCT_1);
const MINUTE_BEFORE_CLOSE = shift(CLOSES_AT, -60_000);
const MINUTE_AFTER_CLOSE = shift(CLOSES_AT, 60_000);

function shift(at: Date, ms: number) {
  return new Date(at.getTime() + ms);
}

let npo_id: number;
let creator_id: string;

async function freeze_now(at: Date) {
  await test_db.current!.client.exec(`set test.now = '${at.toISOString()}'`);
}

async function seed_listed_fund(id: string, expiration: string | null) {
  await test_db.current!.db.insert(funds).values({
    id,
    name: id,
    description_pt: "desc",
    banner: "https://img.co/banner.png",
    logo: "https://img.co/logo.png",
    active: true,
    published: true,
    creator_id,
    npo_owner: npo_id,
    expiration,
  });
}

const listers = {
  fund_search: async () =>
    (await fund_search({ page: 1 })).items.map((f) => f.id),
  fund_npo_memberof: async () =>
    (await fund_npo_memberof(npo_id, { published: true })).map((f) => f.id),
};

beforeAll(async () => {
  test_db.current = await create_test_db();
  // shadows pg_catalog.now() for this session: an unqualified NOW() resolves
  // through search_path, and pg_catalog only wins when it isn't listed.
  await test_db.current.client.exec(`
    create schema test_clock;
    create function test_clock.now() returns timestamptz
      language plpgsql stable as $$
      declare frozen text := nullif(current_setting('test.now', true), '');
      begin
        if frozen is null then
          raise exception 'test.now is unset: call freeze_now() first';
        end if;
        return frozen::timestamptz;
      end $$;
    set search_path = test_clock, pg_catalog, public;
  `);
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const { db, client } = test_db.current!;
  // not utc on purpose: a bound that drops either `at time zone 'utc'` reads
  // this zone instead, and only a non-utc session makes that change the answer
  await client.exec("set time zone 'America/Los_Angeles'");
  // a set is session-wide: without this a test that skips freeze_now runs on
  // the previous test's clock
  await client.exec("reset test.now");
  await db.delete(fund_members);
  await db.delete(funds);
  await db.delete(npos);
  npo_id = (await seed_npo(db)).id;
  creator_id = (await seed_user(db, `${crypto.randomUUID()}@test.com`)).id;
});

describe.each(Object.entries(listers))("%s", (_, list_ids) => {
  test("a fund ending today in utc−12 is listed", async () => {
    await seed_listed_fund("ends-oct-1", OCT_1);
    await freeze_now(MINUTE_BEFORE_CLOSE);

    expect(await list_ids()).toEqual(["ends-oct-1"]);
  });

  test("a fund whose closing instant passed a minute ago is not listed", async () => {
    await seed_listed_fund("ends-oct-1", OCT_1);
    await freeze_now(MINUTE_AFTER_CLOSE);

    expect(await list_ids()).toEqual([]);
  });

  test("the closing instant itself is closed", async () => {
    await seed_listed_fund("ends-oct-1", OCT_1);
    await freeze_now(CLOSES_AT);

    expect(await list_ids()).toEqual([]);
  });

  test("an end date stored with a time of day closes with its date's midnight row", async () => {
    await seed_listed_fund("ends-oct-1-evening", "2026-10-01T18:30:00Z");

    await freeze_now(MINUTE_BEFORE_CLOSE);
    expect(await list_ids()).toEqual(["ends-oct-1-evening"]);

    await freeze_now(MINUTE_AFTER_CLOSE);
    expect(await list_ids()).toEqual([]);
  });

  test("lists exactly the funds the ts rule calls open, at each closing instant", async () => {
    const expirations = [
      "2026-10-01T00:00:00Z",
      "2026-10-15T18:30:00Z",
      "2026-10-31T23:59:59.999Z",
      "2026-12-31T00:00:00Z",
    ];
    for (const e of expirations) await seed_listed_fund(e, e);

    for (const e of expirations) {
      for (const offset of [-1, 0, 1]) {
        const now = shift(fund_closes_at(e), offset);
        await freeze_now(now);

        const open = expirations.filter((x) =>
          fund_is_open({ active: true, expiration: x }, now)
        );
        expect((await list_ids()).sort(), now.toISOString()).toEqual(
          open.sort()
        );
      }
    }
  });

  test("a fund with no end date is listed", async () => {
    await seed_listed_fund("no-end", null);
    await freeze_now(new Date("9999-12-31T00:00:00Z"));

    expect(await list_ids()).toEqual(["no-end"]);
  });
});

test("a query before freeze_now fails instead of reading the previous test's clock", async () => {
  await expect(listers.fund_search()).rejects.toMatchObject({
    cause: { message: expect.stringMatching(/freeze_now/) },
  });
});
