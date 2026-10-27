import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

import { admin_ctx } from "#/.server/auth";
import { create_test_db } from "$/pg/test-utils/pglite";
import { videos_action } from "./api";

const db = () => test_db.current!.db;
const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";
const CAP = "Your page shows up to 4 videos. Take one off first.";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(npo_media);
  await db().delete(npos);
});

let reg = 0;
async function seed_npo() {
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-VIDEOS-${++reg}`,
      name: "Videos Org",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return row!;
}

let tick = 0;
async function seed_video(npo_id: number, featured: boolean, url = YOUTUBE) {
  const [row] = await db()
    .insert(npo_media)
    .values({
      id: crypto.randomUUID(),
      npo_id,
      url,
      type: "video",
      featured,
      date_created: new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(),
    })
    .returning();
  return row!;
}

const videos_of = (npo_id: number) =>
  db().select().from(npo_media).where(eq(npo_media.npo_id, npo_id));

const featured_of = async (npo_id: number) =>
  (await videos_of(npo_id)).filter((v) => v.featured);

/** a fetcher post to the videos action, as `npo_id`'s admin */
async function post(npo_id: number, fields: Record<string, string>) {
  const res = await (videos_action as any)({
    request: new Request(`http://x/admin/${npo_id}/organization/videos`, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: { id: String(npo_id) },
    context: {
      get: (key: unknown) => (key === admin_ctx ? npo_id : undefined),
    },
  });
  // `data()` wraps an answer with a status; a bare object is a 200
  return "init" in res && "data" in res
    ? { status: res.init?.status ?? 200, body: res.data }
    : { status: 200, body: res };
}

describe("feature", () => {
  it("refuses a fifth featured video, writing nothing; taking one off makes room", async () => {
    const npo = await seed_npo();
    const on = [];
    for (let i = 0; i < 4; i++) on.push(await seed_video(npo.id, true));
    const fifth = await seed_video(npo.id, false);

    const refused = await post(npo.id, {
      intent: "feature",
      mediaId: fifth.id,
      featured: "0",
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: CAP });
    expect(await featured_of(npo.id)).toHaveLength(4);

    const off = await post(npo.id, {
      intent: "feature",
      mediaId: on[0]!.id,
      featured: "1",
    });
    expect(off.body).toEqual({ ok: true });
    expect((await featured_of(npo.id)).map((v) => v.id)).not.toContain(
      on[0]!.id
    );

    const shown = await post(npo.id, {
      intent: "feature",
      mediaId: fifth.id,
      featured: "0",
    });
    expect(shown.body).toEqual({ ok: true });
    expect((await featured_of(npo.id)).map((v) => v.id)).toContain(fifth.id);
  });

  it("two presses racing for the last spot: one lands, the other is refused", async () => {
    const npo = await seed_npo();
    for (let i = 0; i < 3; i++) await seed_video(npo.id, true);
    const a = await seed_video(npo.id, false);
    const b = await seed_video(npo.id, false);

    const answers = await Promise.all(
      [a, b].map((v) =>
        post(npo.id, { intent: "feature", mediaId: v.id, featured: "0" })
      )
    );
    expect(answers.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(answers.find((x) => x.status === 409)?.body).toEqual({
      error: CAP,
    });
    expect(await featured_of(npo.id)).toHaveLength(4);
  });
});

describe("feature — the state the sender saw", () => {
  it("a Show press sent twice leaves the video featured, not flipped back", async () => {
    const npo = await seed_npo();
    const v = await seed_video(npo.id, false);
    const press = () =>
      post(npo.id, { intent: "feature", mediaId: v.id, featured: "0" });

    expect((await press()).body).toEqual({ ok: true });
    expect((await featured_of(npo.id)).map((x) => x.id)).toEqual([v.id]);
    expect((await press()).body).toEqual({ ok: true });
    expect((await featured_of(npo.id)).map((x) => x.id)).toEqual([v.id]);
  });

  it("a Show on an already-featured video succeeds while four are featured", async () => {
    const npo = await seed_npo();
    const four = [];
    for (let i = 0; i < 4; i++) four.push(await seed_video(npo.id, true));

    const again = await post(npo.id, {
      intent: "feature",
      mediaId: four[0]!.id,
      featured: "0",
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true });
    expect(await featured_of(npo.id)).toHaveLength(4);
  });
});

describe("refused posts", () => {
  it.each([
    ["missing", {}],
    ["empty", { mediaId: "" }],
  ])("a %s mediaId is a 400, writing nothing", async (_, extra) => {
    const npo = await seed_npo();
    await seed_video(npo.id, true);
    const res = post(npo.id, { intent: "delete", ...extra });
    await expect(res).rejects.toMatchObject({ status: 400 });
    expect(await videos_of(npo.id)).toHaveLength(1);
  });

  it("an unknown intent on an own video is a 400, leaving it as it was", async () => {
    const npo = await seed_npo();
    const v = await seed_video(npo.id, true);
    const res = post(npo.id, { intent: "explode", mediaId: v.id });
    await expect(res).rejects.toMatchObject({ status: 400 });
    expect(await videos_of(npo.id)).toMatchObject([
      { id: v.id, url: YOUTUBE, featured: true },
    ]);
  });
});

describe("add", () => {
  it("adds a YouTube link onto the page, and refuses another site's with a field error", async () => {
    const npo = await seed_npo();

    for (const [url, message] of [
      ["not-a-url", "invalid url"],
      ["https://vimeo.com/123456", "only YouTube links are supported"],
      [
        "https://example.org/youtube.com/watch?v=dQw4w9WgXcQ",
        "only YouTube links are supported",
      ],
    ] as const) {
      const refused = await post(npo.id, { intent: "add", url });
      expect(refused.status).toBe(400);
      expect(refused.body).toEqual({ errors: { url: message } });
    }
    expect(await videos_of(npo.id)).toHaveLength(0);

    const added = await post(npo.id, { intent: "add", url: YOUTUBE });
    expect(added.body).toMatchObject({ ok: true });
    expect(await videos_of(npo.id)).toMatchObject([
      { url: YOUTUBE, featured: true },
    ]);
  });

  it("lands in the list only once the page's spots are full", async () => {
    const npo = await seed_npo();
    for (let i = 0; i < 4; i++) {
      await seed_video(npo.id, true, `https://youtu.be/seed${i}`);
    }

    const added = await post(npo.id, { intent: "add", url: YOUTUBE });
    expect(added.body).toMatchObject({ ok: true });
    expect(await featured_of(npo.id)).toHaveLength(4);
    expect(await videos_of(npo.id)).toHaveLength(5);
  });
});

describe("edit", () => {
  it("changes the link, keeps its featured flag, and refuses another site's", async () => {
    const npo = await seed_npo();
    const v = await seed_video(npo.id, true);

    const refused = await post(npo.id, {
      intent: "edit",
      mediaId: v.id,
      url: "https://vimeo.com/123456",
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      errors: { url: "only YouTube links are supported" },
    });
    expect(await videos_of(npo.id)).toMatchObject([{ url: YOUTUBE }]);

    const other = "https://www.youtube.com/watch?v=9bZkp7q19f0";
    const saved = await post(npo.id, {
      intent: "edit",
      mediaId: v.id,
      url: other,
    });
    expect(saved.body).toEqual({ ok: true });
    expect(await videos_of(npo.id)).toMatchObject([
      { url: other, featured: true },
    ]);
  });
});

describe("another nonprofit's video", () => {
  it("answers not-found to every intent and is left as it was", async () => {
    const mine = await seed_npo();
    const theirs = await seed_npo();
    const v = await seed_video(theirs.id, false);

    const presses: Record<string, string>[] = [
      { intent: "feature", featured: "0" },
      { intent: "edit", url: "https://youtu.be/aaaaaaaaaaa" },
      { intent: "delete" },
    ];
    for (const fields of presses) {
      const res = await post(mine.id, { ...fields, mediaId: v.id });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Video not found" });
    }
    expect(await videos_of(theirs.id)).toMatchObject([
      { url: YOUTUBE, featured: false },
    ]);
  });
});

describe("delete, then undo", () => {
  it.each([true, false])(
    "restores the link with its featured flag (%s)",
    async (featured) => {
      const npo = await seed_npo();
      const url = "https://youtu.be/9bZkp7q19f0";
      const v = await seed_video(npo.id, featured, url);

      const del = await post(npo.id, { intent: "delete", mediaId: v.id });
      expect(del.body).toEqual({ ok: true });
      expect(await videos_of(npo.id)).toHaveLength(0);

      const undo = await post(npo.id, {
        intent: "restore",
        url,
        featured: featured ? "1" : "0",
        date_created: v.date_created!,
      });
      expect(undo.body).toMatchObject({ ok: true });
      expect(await videos_of(npo.id)).toMatchObject([
        { url, featured, date_created: v.date_created },
      ]);
    }
  );

  it("reinserts the removed row under its own id when the press sends it", async () => {
    const npo = await seed_npo();
    const v = await seed_video(npo.id, true);
    await post(npo.id, { intent: "delete", mediaId: v.id });

    const undo = await post(npo.id, {
      intent: "restore",
      mediaId: v.id,
      url: v.url,
      featured: "1",
      date_created: v.date_created!,
    });
    expect(undo.body).toEqual({ ok: true, id: v.id });
    expect(await videos_of(npo.id)).toMatchObject([{ id: v.id }]);
  });

  it("a tab that predates the date field restores at now; one stored without a date stays without", async () => {
    const npo = await seed_npo();
    const before = Date.now();
    await post(npo.id, { intent: "restore", url: YOUTUBE, featured: "0" });
    const [old_tab] = await videos_of(npo.id);
    expect(Date.parse(old_tab!.date_created!)).toBeGreaterThanOrEqual(before);

    await db().delete(npo_media);
    await post(npo.id, {
      intent: "restore",
      url: YOUTUBE,
      featured: "0",
      date_created: "",
    });
    expect(await videos_of(npo.id)).toMatchObject([{ date_created: null }]);
  });

  it("refuses a restore whose date isn't a timestamp, writing nothing", async () => {
    const npo = await seed_npo();
    // only a hand-built post sends one, so it's thrown like a bad media id
    const undo = post(npo.id, {
      intent: "restore",
      url: YOUTUBE,
      featured: "0",
      date_created: "yesterday",
    });
    await expect(undo).rejects.toMatchObject({ status: 400 });
    expect(await videos_of(npo.id)).toHaveLength(0);
  });

  it("restores off the page when the page filled up meanwhile", async () => {
    const npo = await seed_npo();
    for (let i = 0; i < 4; i++) await seed_video(npo.id, true);

    const undo = await post(npo.id, {
      intent: "restore",
      url: "https://youtu.be/9bZkp7q19f0",
      featured: "1",
      date_created: "2025-06-01T00:00:00.000Z",
    });
    expect(undo.body).toMatchObject({ ok: true });
    expect(await featured_of(npo.id)).toHaveLength(4);
    expect(await videos_of(npo.id)).toHaveLength(5);
  });

  it("a second delete press after the first committed answers not-found", async () => {
    const npo = await seed_npo();
    const v = await seed_video(npo.id, true);
    const press = () => post(npo.id, { intent: "delete", mediaId: v.id });

    expect((await press()).body).toEqual({ ok: true });
    const again = await press();
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: "Video not found" });
  });
});
