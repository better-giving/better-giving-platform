import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

import { npo_media, npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import {
  npo_media_feature,
  npo_media_list,
  npo_media_put,
  npo_media_restore,
} from "./npo-media";

const CAP = 4;
let npo_id: number;

const rows = () =>
  test_db
    .current!.db.select()
    .from(npo_media)
    .where(eq(npo_media.npo_id, npo_id));

const featured_count = async () =>
  (
    await test_db
      .current!.db.select()
      .from(npo_media)
      .where(and(eq(npo_media.npo_id, npo_id), eq(npo_media.featured, true)))
  ).length;

beforeAll(async () => {
  test_db.current = await create_test_db();
  const [npo] = await test_db.current.db
    .insert(npos)
    .values({
      registration_number: "EIN-MEDIA",
      name: "Media NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning({ id: npos.id });
  npo_id = npo!.id;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(npo_media);
});

describe("npo_media_put", () => {
  it("writes an unfeatured video unfeatured", async () => {
    const put = await npo_media_put(
      npo_id,
      { url: "https://youtu.be/a", featured: false },
      CAP
    );

    expect(put.featured).toBe(false);
    expect(await rows()).toEqual([
      expect.objectContaining({ id: put.id, featured: false, type: "video" }),
    ]);
  });

  it("features a video while the page has room, and not once it is full", async () => {
    const puts = [];
    for (const n of [1, 2, 3, 4, 5]) {
      puts.push(
        await npo_media_put(
          npo_id,
          { url: `https://youtu.be/${n}`, featured: true },
          CAP
        )
      );
    }

    expect(puts.map((p) => p.featured)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(await featured_count()).toBe(CAP);
  });
});

/** `featured` rows plus one unfeatured, returned last */
async function seed(featured: number) {
  for (let n = 0; n < featured; n++) {
    await npo_media_put(
      npo_id,
      { url: `https://youtu.be/f${n}`, featured: true },
      CAP
    );
  }
  return npo_media_put(
    npo_id,
    { url: "https://youtu.be/off", featured: false },
    CAP
  );
}

describe("npo_media_feature", () => {
  it("features a row below the cap", async () => {
    const off = await seed(3);

    expect(await npo_media_feature(npo_id, off.id, CAP)).toBe(true);
    expect(await featured_count()).toBe(4);
  });

  it("refuses at the cap and leaves the row unfeatured", async () => {
    const off = await seed(4);

    expect(await npo_media_feature(npo_id, off.id, CAP)).toBe(false);
    expect(await featured_count()).toBe(4);
  });

  it("lets one of two concurrent presses at 3 featured through", async () => {
    const a = await seed(3);
    const b = await npo_media_put(
      npo_id,
      { url: "https://youtu.be/off2", featured: false },
      CAP
    );

    const applied = await Promise.all([
      npo_media_feature(npo_id, a.id, CAP),
      npo_media_feature(npo_id, b.id, CAP),
    ]);

    expect(applied.filter(Boolean)).toHaveLength(1);
    expect(await featured_count()).toBe(4);
  });

  it("does not touch another npo's row", async () => {
    const off = await seed(0);

    expect(await npo_media_feature(npo_id + 1, off.id, CAP)).toBe(false);
    expect(await featured_count()).toBe(0);
  });
});

describe("npo_media_restore", () => {
  /** three featured videos a day apart, newest first as the list reads them */
  async function three() {
    const db = test_db.current!.db;
    for (const [n, day] of [
      [1, "03"],
      [2, "02"],
      [3, "01"],
    ] as const) {
      await db.insert(npo_media).values({
        id: `v${n}`,
        npo_id,
        url: `https://youtu.be/v${n}`,
        type: "video",
        featured: true,
        date_created: `2026-01-${day}T00:00:00.000Z`,
      });
    }
  }

  const featured_urls = async () =>
    (await npo_media_list(npo_id, { type: "video", featured: true })).items.map(
      (m) => m.url
    );

  it("puts a removed video back in its spot", async () => {
    await three();
    await test_db.current!.db.delete(npo_media).where(eq(npo_media.id, "v3"));

    const put = await npo_media_restore(
      npo_id,
      {
        url: "https://youtu.be/v3",
        featured: true,
        date_created: "2026-01-01T00:00:00.000Z",
      },
      CAP
    );

    expect(put.featured).toBe(true);
    expect(await featured_urls()).toEqual([
      "https://youtu.be/v1",
      "https://youtu.be/v2",
      "https://youtu.be/v3",
    ]);
  });

  it("answers a repeated restore with the row the first one wrote", async () => {
    await three();
    await test_db.current!.db.delete(npo_media).where(eq(npo_media.id, "v3"));
    const v3 = {
      url: "https://youtu.be/v3",
      featured: true,
      date_created: "2026-01-01T00:00:00.000Z",
    };

    const [first, second] = await Promise.all([
      npo_media_restore(npo_id, v3, CAP),
      npo_media_restore(npo_id, v3, CAP),
    ]);

    expect(second).toEqual(first);
    expect(await rows()).toHaveLength(3);
  });

  it("restores unfeatured when the page filled meanwhile", async () => {
    await seed(4);

    const put = await npo_media_restore(
      npo_id,
      { url: "https://youtu.be/gone", featured: true, date_created: null },
      CAP
    );

    expect(put.featured).toBe(false);
    expect(await featured_count()).toBe(4);
  });
});

describe("npo_media_list", () => {
  /** newest first, ties broken by id descending, undated last */
  const expected = ["d2", "b1", "a1", "z0", "y0"];

  beforeEach(async () => {
    const at = (day: string) => `2026-01-${day}T00:00:00.000Z`;
    await test_db.current!.db.insert(npo_media).values(
      (
        [
          ["a1", at("01")],
          ["y0", null],
          ["d2", at("02")],
          ["z0", null],
          ["b1", at("01")],
        ] as const
      ).map(([id, date_created]) => ({
        id,
        npo_id,
        url: `https://youtu.be/${id}`,
        type: "video" as const,
        date_created,
      }))
    );
  });

  it("sorts undated videos last", async () => {
    const page = await npo_media_list(npo_id, { type: "video" });

    expect(page.items.map((m) => m.id)).toEqual(expected);
    expect(page.next).toBeUndefined();
  });

  it("pages through ties and undated rows without dropping or repeating one", async () => {
    const seen: string[] = [];
    let next: string | undefined;
    do {
      const page = await npo_media_list(npo_id, {
        type: "video",
        limit: 1,
        next,
      });
      seen.push(...page.items.map((m) => m.id));
      next = page.next;
    } while (next && seen.length < 10);

    expect(seen).toEqual(expected);
  });
});
