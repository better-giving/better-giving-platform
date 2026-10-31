import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { npos } from "../schema/npo";
import { create_test_db, type TestDb } from "../test-utils/pglite";
import { npos_by_regnums } from "./npo";

const current = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({
  db: new Proxy(
    {},
    { get: (_, prop) => (current.db as Record<PropertyKey, unknown>)[prop] }
  ),
}));

let test_db: TestDb;

beforeAll(async () => {
  test_db = await create_test_db();
  current.db = test_db.db;
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  await test_db.db.delete(npos);
});

function seed(
  registration_number: string,
  hq_country = "United States",
  name = registration_number
) {
  return test_db.db.insert(npos).values({
    registration_number,
    name,
    endow_designation: "Charity",
    overview_pt: "[]",
    hq_country,
  });
}

describe("npos_by_regnums", () => {
  test("an empty list returns nothing and does not need a match", async () => {
    await seed("12-3456789");
    await expect(npos_by_regnums([])).resolves.toEqual([]);
  });

  test("a dashed stored EIN matches undashed digits", async () => {
    await seed("12-3456789", "United States", "Dashed");
    const rows = await npos_by_regnums(["123456789"]);
    expect(rows).toEqual([
      expect.objectContaining({
        name: "Dashed",
        registration_number: "12-3456789",
        hq_country: "United States",
      }),
    ]);
  });

  test("an undashed stored EIN matches itself", async () => {
    await seed("123456789", "United States", "Plain");
    const rows = await npos_by_regnums(["123456789"]);
    expect(rows.map((row) => row.name)).toEqual(["Plain"]);
  });

  test("a dashed argument matches a dashed stored EIN", async () => {
    await seed("12-3456789", "United States", "Dashed");
    const rows = await npos_by_regnums(["12-3456789"]);
    expect(rows.map((row) => row.registration_number)).toEqual(["12-3456789"]);
  });

  test("a non-US row with the same digits is absent", async () => {
    await seed("12-3456789", "Canada", "Abroad");
    await expect(npos_by_regnums(["123456789"])).resolves.toEqual([]);
  });

  test("a different EIN is absent", async () => {
    await seed("98-7654321", "United States", "Other");
    await expect(npos_by_regnums(["123456789"])).resolves.toEqual([]);
  });

  test("one call returns each matching US npo once", async () => {
    await seed("12-3456789", "United States", "First");
    await seed("111111111", "United States", "Second");
    await seed("98-7654321", "Canada", "Abroad");
    const rows = await npos_by_regnums([
      "123456789",
      "12-3456789",
      "111111111",
    ]);
    expect(rows.map((row) => row.name).sort()).toEqual(["First", "Second"]);
  });
});

describe("npos_by_regnums increments", () => {
  test("a match carries the npo's stored increments, null when unset", async () => {
    const increments = [{ value: "25", label: "Feed a child" }];
    await test_db.db.insert(npos).values({
      registration_number: "12-3456789",
      name: "With",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      increments,
    });
    await seed("98-7654321", "United States", "Without");

    const rows = await npos_by_regnums(["123456789", "987654321"]);
    const by_name = Object.fromEntries(rows.map((r) => [r.name, r.increments]));

    expect(by_name).toEqual({ With: increments, Without: null });
  });
});
