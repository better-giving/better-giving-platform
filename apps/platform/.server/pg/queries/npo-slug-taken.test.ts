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
import { npo_slug_taken } from "./npo";

async function seed(slug: string | null) {
  await test_db.current!.db.insert(npos).values({
    registration_number: `EIN-${slug ?? "none"}`,
    name: "Slug NPO",
    endow_designation: "Charity",
    overview_pt: "[]",
    hq_country: "United States",
    slug,
  });
}

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(npos);
});

test("a slug a nonprofit holds is taken", async () => {
  await seed("held-slug");
  expect(await npo_slug_taken("held-slug")).toBe(true);
});

test("a slug held in a different case is taken", async () => {
  await seed("Held-Slug");
  expect(await npo_slug_taken("hELD-sLUG")).toBe(true);
});

test("a slug nobody holds is free", async () => {
  await seed("held-slug");
  expect(await npo_slug_taken("other-slug")).toBe(false);
});

test("a nonprofit with no slug holds nothing", async () => {
  await seed(null);
  expect(await npo_slug_taken("")).toBe(false);
  expect(await npo_slug_taken("null")).toBe(false);
});

test("the lookup reads npos through npos_slug_lower_idx alone", async () => {
  await seed("held-slug");
  const { client } = test_db.current!;
  // a one-row table never picks the index on cost; forbid the seq scan to ask
  // whether the predicate lets the planner use it at all
  await client.exec("SET enable_seqscan = off");
  const issued = vi.spyOn(client, "query");
  try {
    await npo_slug_taken("held-slug");
    const [query, params] = issued.mock.calls[0]!;
    expect(query).not.toContain("contributions");
    const plan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN ${query}`,
      params
    );
    const lines = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(lines).toContain("npos_slug_lower_idx");
    // an index condition, not the partial index walked whole under a filter
    expect(lines).toMatch(/Index Cond: \(lower\(slug\) =/);
  } finally {
    issued.mockRestore();
    await client.exec("RESET enable_seqscan");
  }
});
