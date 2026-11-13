import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { banking_apps } from "../schema/banking";
import { npos } from "../schema/npo";
import { registrations } from "../schema/registration";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("../db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const { bapp_set_holder, bapps_missing_holder, npo_legal_names } = await import(
  "./banking"
);

beforeAll(async () => {
  const { create_test_db } = await import("../test-utils/pglite");
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const db = () => test_db.current!.db;

const insert_npo = async (registration_number: string, name: string) => {
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning({ id: npos.id });
  return row!.id;
};

const holder_of = async (id: string) =>
  (
    await db()
      .select({ h: banking_apps.account_holder })
      .from(banking_apps)
      .where(eq(banking_apps.id, id))
  )[0]?.h;

beforeEach(async () => {
  await db().delete(banking_apps);
  await db().delete(registrations);
  await db().delete(npos);
});

describe("npo_legal_names", () => {
  test("the name the nonprofit registered under, not the page name it edited since", async () => {
    const id = await insert_npo("EIN-1", "Harbor Light");
    await db().insert(registrations).values({
      id: "reg-1",
      r_id: "a@x.test",
      status: "03",
      o_name: "Harbor Light Food Pantry Inc.",
      status_approved_npo_id: id,
    });

    expect(await npo_legal_names([id])).toEqual(
      new Map([[id, "Harbor Light Food Pantry Inc."]])
    );
  });

  test("a nonprofit with no registration on file, or a blank one, falls back to its name", async () => {
    const bare = await insert_npo("EIN-2", "Bread and Roses");
    const blank = await insert_npo("EIN-3", "Acme Relief");
    await db().insert(registrations).values({
      id: "reg-3",
      r_id: "b@x.test",
      status: "03",
      o_name: "  ",
      status_approved_npo_id: blank,
    });

    expect(await npo_legal_names([bare, blank])).toEqual(
      new Map([
        [bare, "Bread and Roses"],
        [blank, "Acme Relief"],
      ])
    );
  });
});

describe("holder backfill", () => {
  test("lists approved and default applications with no holder, a page at a time by id", async () => {
    const npo = await insert_npo("EIN-4", "Acme Relief");
    await db()
      .insert(banking_apps)
      .values([
        { id: "1", npo_id: npo, status: "default" },
        { id: "2", npo_id: npo, status: "approved" },
        { id: "3", npo_id: npo, status: "approved", account_holder: "Acme" },
        { id: "4", npo_id: npo, status: "under-review" },
        { id: "5", npo_id: npo, status: "rejected" },
      ]);

    const first = await bapps_missing_holder(1);
    const rest = await bapps_missing_holder(10, first.at(-1)?.id);

    expect(first.map((r) => r.id)).toEqual(["1"]);
    expect(rest.map((r) => r.id)).toEqual(["2"]);
    expect(rest[0]).toMatchObject({ npo_id: npo });
  });

  test("stores a holder only where none is stored", async () => {
    const npo = await insert_npo("EIN-5", "Acme Relief");
    await db()
      .insert(banking_apps)
      .values([
        { id: "1", npo_id: npo, status: "default" },
        { id: "2", npo_id: npo, status: "approved", account_holder: "Kept" },
      ]);

    expect(await bapp_set_holder("1", "Acme Relief Inc")).toBe(true);
    expect(await bapp_set_holder("2", "Overwritten")).toBe(false);
    expect(await holder_of("1")).toBe("Acme Relief Inc");
    expect(await holder_of("2")).toBe("Kept");
  });
});
