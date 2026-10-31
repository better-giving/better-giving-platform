import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { npo_media, npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((d: unknown) => d),
}));

import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const read = async (npo_id: number, search: string) =>
  (await (loader as any)({
    params: { id: String(npo_id) },
    request: new Request(`http://x/admin/${npo_id}/organization${search}`),
  })) as Awaited<ReturnType<typeof loader>>;

describe("organization loader — videos", () => {
  it("offers no more once Load more has reached the most it shows", async () => {
    const [npo] = await db()
      .insert(npos)
      .values({
        registration_number: "EIN-ORG-LOADER",
        name: "Many Videos",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    await db()
      .insert(npo_media)
      .values(
        Array.from({ length: 201 }, (_, i) => ({
          id: crypto.randomUUID(),
          npo_id: npo!.id,
          url: `https://youtu.be/vid${String(i).padStart(8, "0")}`,
          type: "video" as const,
          featured: false,
          date_created: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }))
      );

    const first = await read(npo!.id, "");
    expect(first.videos.has_more).toBe(true);

    const clamped = await read(npo!.id, "?videos=210");
    expect(clamped.videos.items).toHaveLength(200);
    expect(clamped.videos.has_more).toBe(false);
  });
});
