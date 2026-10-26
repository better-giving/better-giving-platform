import { afterAll, beforeAll, expect, test } from "vitest";
import { create_test_db, type TestDb } from "../test-utils/pglite";

// 0073 narrows the sweep's index to the rows the sweep deletes: a saved link is
// kept for good, so a full expires_at index only grows with rows it skips.
let t: TestDb;

beforeAll(async () => {
  t = await create_test_db();
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

const photo_link_indexes = async () =>
  (
    await t.client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where tablename = 'connector_photo_links' and indexname like '%expires_at%'`
    )
  ).rows;

test("the sweep's expires_at index is partial on unsaved links, and the full one is gone", async () => {
  const rows = await photo_link_indexes();
  expect(rows.map((r) => r.indexname)).toEqual([
    "connector_photo_links_unsaved_expires_at_idx",
  ]);
  expect(rows[0].indexdef).toMatch(
    /\(expires_at\) WHERE \(saved_pathname IS NULL\)$/
  );
});

test("the planner takes the partial index for the sweep's predicate", async () => {
  await t.client.query("set enable_seqscan = off");
  const plan = await t.client.query<{ "QUERY PLAN": string }>(
    `explain delete from connector_photo_links
     where expires_at < now() and saved_pathname is null`
  );
  await t.client.query("reset enable_seqscan");
  expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
    "connector_photo_links_unsaved_expires_at_idx"
  );
});
