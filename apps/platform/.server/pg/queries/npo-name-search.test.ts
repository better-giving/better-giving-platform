import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

import { npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import { npo_name_search } from "./npo";

const UNRELATED = [
  "American Cancer Society",
  "American Heart Association",
  "Americares Foundation",
  "Red Cross of Kenya",
  "Holy Cross Hospital",
  "Cross Roads Ministry",
  "Red Rover",
];

async function list(names: string[], active = true) {
  await test_db.current!.db.insert(npos).values(
    names.map((name, i) => ({
      registration_number: `${name}-${i}`,
      name,
      endow_designation: "Charity" as const,
      overview_pt: "[]",
      hq_country: "United States",
      active,
    }))
  );
}

const names = async (q: string) =>
  (await npo_name_search(q)).map((hit) => hit.name);

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(npos);
  await list(UNRELATED);
});

test("an unlisted org's name finds none of the orgs sharing a word with it", async () => {
  expect(await names("American Red Cross")).toEqual([]);
});

test("a listed org comes first and exact, with its namesakes after", async () => {
  await list(["American National Red Cross", "American Red Cross"]);

  const hits = await npo_name_search("american red cross");

  expect(hits.map((hit) => [hit.name, hit.match])).toEqual([
    ["American Red Cross", "exact"],
    ["American National Red Cross", "close"],
  ]);
});

test("a whole-word prefix outranks a closer-scoring name", async () => {
  await list([
    "The Habitat for Humanity",
    "Habitat for Humanity International",
  ]);

  expect(await names("Habitat for Humanity")).toEqual([
    "Habitat for Humanity International",
    "The Habitat for Humanity",
  ]);
});

test("a misspelt name still finds the org", async () => {
  await list(["Regenerosity"]);

  expect(await names("regenerosty")).toEqual(["Regenerosity"]);
});

test("every query word in the name is a match, however short the query", async () => {
  await list(["St. Jude Children's Research Hospital"]);

  expect(await names("St Jude")).toEqual([
    "St. Jude Children's Research Hospital",
  ]);
  expect(await names("red cross")).toEqual(["Red Cross of Kenya"]);
});

test("a LIKE wildcard in the query matches nothing by itself", async () => {
  await list(["100% Kids"]);

  expect(await names("100% kids")).toEqual(["100% Kids"]);
  expect(await names("%")).toEqual([]);
});

test("an inactive org is not a match", async () => {
  await list(["American Red Cross"], false);

  expect(await names("American Red Cross")).toEqual([]);
});
