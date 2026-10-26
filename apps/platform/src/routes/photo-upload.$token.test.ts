import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  createRequestHandler,
  createStaticHandler,
  type EntryContext,
  RouterProvider,
  type ServerBuild,
  useActionData,
  useLoaderData,
} from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { PhotoUploadPage } from "#/components/photo-upload";
import {
  photo_too_large,
  photo_types,
  photo_wrong_type,
  upload_limits,
} from "@/constants/upload";
import {
  issue_photo_link,
  PHOTO_CLAIM_PENDING_MS,
} from "$/connector/photo-links";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { campaigns } from "$/pg/schema/campaign";
import { connector_photo_links } from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";
import * as route from "./photo-upload.$token";

const MIB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const UNCONFIRMED_TITLE = "We couldn't confirm your photo was saved";
const UNCONFIRMED_LEDE =
  "We couldn't confirm your photo was saved. Open this link again";

const { put, del } = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, del }));
vi.mock("$/env", () => ({ blob: { read_write_token: "tok" } }));

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

const BLOB_URL = "https://blob.test/u/photo-abc.png";
const GONE =
  "Upload links work once and expire after 15 minutes. Ask whoever sent you this link for a new one.";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  reset_rate_limits();
  put.mockReset();
  put.mockResolvedValue({ url: BLOB_URL });
  del.mockReset();
  del.mockResolvedValue(undefined);
  await db().delete(connector_photo_links);
  await db().delete(campaigns);
  await db().delete(npos);
  await db().delete(user);
});

async function seed() {
  const npo = (await seed_npo(db(), {
    name: "Alpha",
    registration_number: "EIN-A",
  }))!;
  const owner = (await seed_user(db(), "a@test.com", "Alpha", "Owner"))!;
  const id = crypto.randomUUID();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id: npo.id,
      creator_id: owner.id,
      name: "Library drive",
      slug: `library-drive-${id.slice(0, 8)}`,
      description_pt: "[]",
      banner: "https://blob.test/u/old.png",
      status: "live",
    });
  const issued = (await issue_photo_link(as_db(db()), npo.id, id))!;
  return { campaign_id: id, token: issued.token };
}

const banner_of = async (id: string) => {
  const [row] = await db()
    .select({ banner: campaigns.banner })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return row?.banner;
};

const used_at_of = async () => {
  const [row] = await db()
    .select({ used_at: connector_photo_links.used_at })
    .from(connector_photo_links);
  return row?.used_at;
};

type Result = { data: Record<string, unknown>; init: { status: number } };

const get = async (token: string) => {
  const request = new Request(`https://bg.test/photo-upload/${token}`);
  return (await route.loader({
    request,
    params: { token },
    context: {},
  } as unknown as Parameters<typeof route.loader>[0])) as unknown as Result;
};

const bytes = (...xs: number[]) => new Uint8Array(xs);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>';

const photo = (parts: BlobPart[], type: string, name: string) =>
  new File(parts, name, { type });

/** set by the stand-in entry: the response came from rendering the document */
const RENDERED = "x-test-document";

/** the route behind the framework's own request handler, middleware on; the
 * entry answers with the data a document would have rendered, so a no-JS post
 * reads back the same way the upload script's does */
const build_of = (mod: object) =>
  ({
    entry: {
      module: {
        default: (
          _req: Request,
          status: number,
          headers: Headers,
          { staticHandlerContext: ctx }: EntryContext
        ) =>
          Response.json(
            ctx.actionData?.photo ?? ctx.loaderData?.photo ?? null,
            {
              status,
              headers: { ...Object.fromEntries(headers), [RENDERED]: "1" },
            }
          ),
      },
    },
    routes: {
      photo: {
        id: "photo",
        path: "photo-upload/:token",
        module: mod,
        children: [],
      },
    },
    assets: { routes: {}, entry: {}, url: "", version: "" },
    publicPath: "/",
    assetsBuildDirectory: "build",
    future: { v8_middleware: true },
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  }) as unknown as ServerBuild;

const serve = (request: Request, mod: object = route) =>
  createRequestHandler(build_of(mod), "test")(request);

const no_leak = (res: Response) => {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
};

/** `document` is the form posting natively; `script` is the page's own upload */
type Mode = "document" | "script";

const poster =
  (mode: Mode) =>
  async (
    token: string,
    file: File | string | null,
    init: { ip?: string; headers?: Record<string, string> } = {}
  ): Promise<Result> => {
    const form = new FormData();
    if (file !== null) form.set("photo", file);
    const res = await serve(
      new Request(`https://bg.test/photo-upload/${token}`, {
        method: "POST",
        body: form,
        headers: {
          "x-forwarded-for": init.ip ?? "203.0.113.9",
          ...(mode === "script" ? { accept: "application/json" } : {}),
          ...init.headers,
        },
      })
    );
    no_leak(res);
    expect(res.headers.has(RENDERED)).toBe(mode === "document");
    if (mode === "script") {
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    const text = await res.text();
    if (token) expect(text).not.toContain(token);
    return { data: JSON.parse(text), init: { status: res.status } };
  };

const submit = poster("document");

/** the page in a data router: its logo is a router link */
const router_of = (loaderData: unknown, actionData?: unknown) => {
  function Page() {
    return createElement(route.default as any, {
      loaderData: useLoaderData(),
      actionData: useActionData(),
    });
  }
  return createMemoryRouter(
    [
      {
        id: "photo",
        path: "/p",
        loader: () => loaderData,
        Component: Page,
      },
    ],
    {
      initialEntries: ["/p"],
      hydrationData: {
        loaderData: { photo: loaderData },
        ...(actionData === undefined
          ? {}
          : { actionData: { photo: actionData } }),
      },
    }
  );
};

const markup = (router: ReturnType<typeof router_of>) =>
  renderToStaticMarkup(createElement(RouterProvider, { router })).replaceAll(
    "&#x27;",
    "'"
  );

const html_of = (loaderData: unknown, actionData?: unknown) =>
  markup(router_of(loaderData, actionData));

describe("GET /photo-upload/:token", () => {
  test("a live link shows the campaign and a single image field, never the token", async () => {
    const { token } = await seed();

    const res = await get(token);

    expect(res.init.status).toBe(200);
    expect(res.data).toEqual({ state: "ready", campaign: "Library drive" });
    const html = html_of(res.data);
    expect(html).toContain("Library drive");
    const form = /<form[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form.toLowerCase()).toContain('enctype="multipart/form-data"');
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(1);
    for (const attr of [
      'type="file"',
      'name="photo"',
      'accept="image/jpeg,image/png,image/webp"',
      "required",
    ]) {
      expect(inputs[0]).toContain(attr);
    }
    expect(html).not.toContain(token);
  });

  test("unknown, malformed, expired and spent links that saved nothing are one identical 404", async () => {
    const { token } = await seed();
    const unknown = await get("A".repeat(43));
    const malformed = await get("not a token");

    await db()
      .update(connector_photo_links)
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const expired = await get(token);

    const fresh = await seed2();
    // spent past the window in which a claim still reads as saving
    await db()
      .update(connector_photo_links)
      .set({
        used_at: new Date(
          Date.now() - PHOTO_CLAIM_PENDING_MS - 60_000
        ).toISOString(),
      })
      .where(eq(connector_photo_links.campaign_id, fresh.campaign_id));
    const used = await get(fresh.token);

    for (const res of [unknown, malformed, expired, used]) {
      expect(res.init.status).toBe(404);
      expect(res.data).toEqual({ state: "gone" });
    }
    const html = html_of(unknown.data);
    expect(html).toContain(GONE);
    expect(html).not.toContain("<form");
  });

  test("a link whose photo saved opens on the saved photo, past its expiry and after the campaign ends", async () => {
    const { token, campaign_id } = await seed();
    await submit(token, photo([PNG], "image/png", "a.png"));
    await db()
      .update(connector_photo_links)
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() });
    await db()
      .update(campaigns)
      .set({ status: "ended" })
      .where(eq(campaigns.id, campaign_id));

    const res = await get(token);
    expect(res.init.status).toBe(200);
    expect(res.data).toEqual({
      state: "saved",
      campaign: "Library drive",
      photo: BLOB_URL,
    });
    const html = html_of(res.data);
    expect(html).toContain("Photo added");
    expect(html).toContain(`src="${BLOB_URL}"`);
    expect(html).not.toContain("<form");
  });

  test("a saved link's photo shows until a day past its expiry, then the link is the generic 404", async () => {
    const { token } = await seed();
    await submit(token, photo([PNG], "image/png", "a.png"));
    const expire_ago = (ms: number) =>
      db()
        .update(connector_photo_links)
        .set({ expires_at: new Date(Date.now() - ms).toISOString() });

    await expire_ago(DAY - 60_000);
    expect((await get(token)).data).toMatchObject({ state: "saved" });

    await expire_ago(DAY + 60_000);
    const res = await get(token);
    expect(res.init.status).toBe(404);
    expect(res.data).toEqual({ state: "gone" });
    const html = html_of(res.data);
    expect(html).toContain(GONE);
    expect(html).not.toContain(BLOB_URL);
  });

  test("reopened while another request's claim is still saving, the link reads as unconfirmed; claimed long ago with nothing saved, it is the generic 404", async () => {
    const { token } = await seed();
    const claimed_ago = (ms: number) =>
      db()
        .update(connector_photo_links)
        .set({ used_at: new Date(Date.now() - ms).toISOString() });

    await claimed_ago(60_000);
    const in_flight = await get(token);
    expect(in_flight.init.status).toBe(409);
    expect(in_flight.data).toEqual({
      state: "unknown",
      campaign: "Library drive",
    });
    const html = html_of(in_flight.data);
    expect(html).toContain(UNCONFIRMED_TITLE);
    expect(html).not.toContain("<form");

    await claimed_ago(PHOTO_CLAIM_PENDING_MS + 60_000);
    const dead = await get(token);
    expect(dead.init.status).toBe(404);
    expect(dead.data).toEqual({ state: "gone" });
  });
});

/** a second org and campaign, so one test can hold two links */
async function seed2() {
  const npo = (await seed_npo(db(), {
    name: "Beta",
    registration_number: "EIN-B",
  }))!;
  const owner = (await seed_user(db(), "b@test.com", "Beta", "Owner"))!;
  const id = crypto.randomUUID();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id: npo.id,
      creator_id: owner.id,
      name: "Food bank",
      slug: `food-bank-${id.slice(0, 8)}`,
      description_pt: "[]",
      status: "draft",
    });
  const issued = (await issue_photo_link(as_db(db()), npo.id, id))!;
  return { campaign_id: id, token: issued.token };
}

describe.each(["document", "script"] as const)(
  "POST /photo-upload/:token, sent by the %s",
  (mode) => {
    const submit = poster(mode);

    test("a png becomes the banner, the link is spent, and a second post shows the saved photo and stores nothing", async () => {
      const { token, campaign_id } = await seed();

      const res = await submit(token, photo([PNG], "image/png", "../me.png"));

      expect(res.init.status).toBe(200);
      expect(res.data).toEqual({
        state: "saved",
        campaign: "Library drive",
        photo: BLOB_URL,
      });
      expect(await banner_of(campaign_id)).toBe(BLOB_URL);
      expect(await used_at_of()).not.toBeNull();
      const [path, , opts] = put.mock.calls[0]!;
      expect(path).toBe("u/me.png");
      expect(opts).toMatchObject({
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
        allowOverwrite: false,
        token: "tok",
      });
      const html = html_of({ state: "gone" }, res.data);
      expect(html).toContain("Photo added");
      expect(html).toContain(`src="${BLOB_URL}"`);
      expect(html).toContain(
        "This link is now used up. You can close this tab."
      );

      const [link] = await db().select().from(connector_photo_links);
      expect(link).toMatchObject({
        saved_url: BLOB_URL,
        saved_pathname: "/u/photo-abc.png",
      });

      put.mockResolvedValue({ url: "https://blob.test/u/second.png" });
      const again = await submit(token, photo([PNG], "image/png", "b.png"));
      expect(again.init.status).toBe(200);
      expect(again.data).toEqual(res.data);
      expect(put).toHaveBeenCalledTimes(1);
      expect(await banner_of(campaign_id)).toBe(BLOB_URL);
    });

    test.each([
      ["image/png", "pic.png", [PNG], "u/pic.png"],
      ["image/jpeg", "pic.jpg", [bytes(0xff, 0xd8, 0xff, 0xe0)], "u/pic.jpg"],
      [
        "image/webp",
        "pic.webp",
        ["RIFF", bytes(1, 2, 3, 4), "WEBPVP8 "],
        "u/pic.webp",
      ],
    ] as const)(
      "a %s photo is stored under its own extension and type",
      async (type, name, parts, path) => {
        const { token, campaign_id } = await seed();

        const res = await submit(token, photo([...parts], type, name));

        expect(res.init.status).toBe(200);
        expect(await banner_of(campaign_id)).toBe(BLOB_URL);
        const [stored_path, , opts] = put.mock.calls[0]!;
        expect(stored_path).toBe(path);
        expect(opts).toMatchObject({ contentType: type });
      }
    );

    test("a name with nothing left after basename is stored as campaign-photo", async () => {
      const { token } = await seed();

      await submit(token, photo([PNG], "image/png", "uploads/"));

      expect(put.mock.calls[0]![0]).toBe("u/campaign-photo.png");
    });

    test("an expired link is the generic 404 and stores nothing", async () => {
      const { token, campaign_id } = await seed();
      await db()
        .update(connector_photo_links)
        .set({ expires_at: new Date(Date.now() - 1000).toISOString() });

      const res = await submit(token, photo([PNG], "image/png", "a.png"));

      expect(res.init.status).toBe(404);
      expect(res.data).toEqual({ state: "gone" });
      expect(put).not.toHaveBeenCalled();
      expect(await banner_of(campaign_id)).toBe("https://blob.test/u/old.png");
    });

    test("two posts at once store one file: the first saves it, the other reads unconfirmed while it's still on its way", async () => {
      const { token, campaign_id } = await seed();
      let first_answered!: () => void;
      const answered = new Promise<void>((r) => {
        first_answered = r;
      });
      // the winner's store waits on the other post's answer, so that answer
      // comes while the claim has recorded nothing
      put.mockImplementation(async () => {
        await answered;
        return { url: BLOB_URL };
      });
      const post = () =>
        submit(token, photo([PNG], "image/png", "a.png")).finally(
          first_answered
        );

      const results = await Promise.all([post(), post()]);

      const saved = results.filter((r) => r.data.state === "saved");
      const unconfirmed = results.filter((r) => r.data.state === "unknown");
      expect(saved).toHaveLength(1);
      expect(saved[0]!.data).toEqual({
        state: "saved",
        campaign: "Library drive",
        photo: BLOB_URL,
      });
      expect(unconfirmed).toHaveLength(1);
      expect(unconfirmed[0]!.data).toEqual({
        state: "unknown",
        campaign: "Library drive",
      });
      expect(put).toHaveBeenCalledTimes(1);
      expect(del).not.toHaveBeenCalled();
      expect(await banner_of(campaign_id)).toBe(BLOB_URL);
      const [link] = await db().select().from(connector_photo_links);
      expect(link).toMatchObject({ saved_url: BLOB_URL });
      // the unconfirmed one, opened again, shows the photo that saved
      expect((await get(token)).data).toMatchObject({ state: "saved" });
    });

    test("a link another request claimed and is still saving reads as unconfirmed; one claimed long ago that saved nothing is the generic 404", async () => {
      const { token } = await seed();
      const claimed_ago = (ms: number) =>
        db()
          .update(connector_photo_links)
          .set({ used_at: new Date(Date.now() - ms).toISOString() });

      await claimed_ago(60_000);
      const in_flight = await submit(token, photo([PNG], "image/png", "a.png"));
      expect(in_flight.init.status).toBe(409);
      expect(in_flight.data).toEqual({
        state: "unknown",
        campaign: "Library drive",
      });
      expect(html_of(null, in_flight.data)).toContain(UNCONFIRMED_TITLE);

      await claimed_ago(PHOTO_CLAIM_PENDING_MS + 60_000);
      const dead = await submit(token, photo([PNG], "image/png", "a.png"));
      expect(dead.init.status).toBe(404);
      expect(dead.data).toEqual({ state: "gone" });
      expect(put).not.toHaveBeenCalled();
    });

    test("unknown and malformed links are the same 404, and store nothing", async () => {
      for (const token of ["A".repeat(43), "not a token"]) {
        const res = await submit(token, photo([PNG], "image/png", "a.png"));
        expect(res.init.status).toBe(404);
        expect(res.data).toEqual({ state: "gone" });
      }
      expect(put).not.toHaveBeenCalled();
    });

    test.each([
      [
        "pdf bytes declared pdf",
        ["%PDF-1.7\n"],
        "application/pdf",
        "a.pdf",
        415,
      ],
      ["an svg declared svg", [SVG], "image/svg+xml", "a.svg", 415],
      ["svg bytes declared png", [SVG], "image/png", "a.png", 415],
      ["an untyped .svg", [SVG], "", "a.svg", 415],
      ["png bytes declared jpeg", [PNG], "image/jpeg", "a.jpg", 415],
      [
        "a png past the cap",
        [PNG, new Uint8Array(upload_limits.max_bytes)],
        "image/png",
        "a.png",
        413,
      ],
    ] as const)(
      "%s is refused and the link stays usable",
      async (_, parts, type, name, status) => {
        const { token, campaign_id } = await seed();

        const res = await submit(token, photo([...parts], type, name));

        expect(res.init.status).toBe(status);
        expect(res.data).toMatchObject({
          state: "ready",
          campaign: "Library drive",
          error: expect.any(String),
        });
        expect(put).not.toHaveBeenCalled();
        expect(await used_at_of()).toBeNull();
        const html = html_of({ state: "ready", campaign: "x" }, res.data);
        expect(html).toContain(res.data.error as string);
        expect(html).toContain('name="photo"');

        const ok = await submit(token, photo([PNG], "image/png", "a.png"));
        expect(ok.data).toMatchObject({ state: "saved" });
        expect(await banner_of(campaign_id)).toBe(BLOB_URL);
      }
    );

    test("a photo of exactly the cap is saved, and one byte more is refused as too large", async () => {
      const at_size = (size: number) =>
        photo([PNG, new Uint8Array(size - PNG.length)], "image/png", "a.png");
      const { token } = await seed();

      const over = await submit(token, at_size(upload_limits.max_bytes + 1));
      expect(over.init.status).toBe(413);
      expect(over.data).toMatchObject({
        state: "ready",
        error: photo_too_large,
      });
      expect(put).not.toHaveBeenCalled();

      const cap = await submit(token, at_size(upload_limits.max_bytes));
      expect(cap.init.status).toBe(200);
      expect(cap.data).toMatchObject({ state: "saved" });
      expect(put.mock.calls[0]![1]).toHaveProperty(
        "size",
        upload_limits.max_bytes
      );
    });

    test("a declared body past the cap is refused before it is read", async () => {
      const { token } = await seed();

      const res = await submit(token, photo([PNG], "image/png", "a.png"), {
        headers: {
          "content-length": String(upload_limits.max_bytes + 64 * 1024 + 1),
        },
      });

      expect(res.init.status).toBe(413);
      expect(await used_at_of()).toBeNull();
    });

    test("no file in the form is a 400 that keeps the link", async () => {
      const { token } = await seed();

      const missing = await submit(token, null);
      const text = await submit(token, "not a file");

      for (const res of [missing, text]) {
        expect(res.init.status).toBe(400);
        expect(res.data).toMatchObject({ state: "ready" });
      }
      expect(await used_at_of()).toBeNull();
    });

    test("a store that throws is a 500 and the same link works afterwards", async () => {
      const { token, campaign_id } = await seed();
      put.mockRejectedValueOnce(new Error("blob down"));

      const failed = await submit(token, photo([PNG], "image/png", "a.png"));

      expect(failed.init.status).toBe(500);
      expect(failed.data).toEqual({
        state: "failed",
        campaign: "Library drive",
      });
      expect(await used_at_of()).toBeNull();
      expect(await banner_of(campaign_id)).toBe("https://blob.test/u/old.png");
      const html = html_of({ state: "gone" }, failed.data);
      expect(html).toContain("this link still works");
      expect(html.indexOf("couldn't be saved")).toBeGreaterThan(-1);
      expect(html.indexOf("couldn't be saved")).toBeLessThan(
        html.indexOf('name="photo"')
      );

      const ok = await submit(token, photo([PNG], "image/png", "a.png"));
      expect(ok.data).toMatchObject({ state: "saved" });
    });

    test("a save whose commit can't be checked keeps the stored file and the spent link", async () => {
      const { token, campaign_id } = await seed();
      const real = db();
      const transaction = real.transaction.bind(real);
      const select = vi.spyOn(real, "select");
      // the commit lands, its reply is lost, and the read that would tell is down too
      const tx = vi.spyOn(real, "transaction").mockImplementationOnce((async (
        ...args: unknown[]
      ) => {
        await (transaction as any)(...args);
        select.mockImplementation(() => {
          throw new Error("db down");
        });
        throw new Error("connection lost");
      }) as typeof real.transaction);

      const res = await submit(token, photo([PNG], "image/png", "a.png"));
      select.mockRestore();
      tx.mockRestore();

      expect(res.init.status).toBe(500);
      expect(res.data).toEqual({ state: "unknown", campaign: "Library drive" });
      const html = html_of(null, res.data);
      expect(html).toContain(UNCONFIRMED_TITLE);
      expect(html).toContain(UNCONFIRMED_LEDE);
      expect(html).not.toContain("<form");
      expect(del).not.toHaveBeenCalled();
      expect(await banner_of(campaign_id)).toBe(BLOB_URL);
      expect(await used_at_of()).not.toBeNull();
      // once the read is back, the link shows the photo it saved
      expect((await get(token)).data).toMatchObject({
        state: "saved",
        photo: BLOB_URL,
      });
    });

    test("a campaign deleted after the link was claimed is the generic 404", async () => {
      const { token, campaign_id } = await seed();
      put.mockImplementationOnce(async () => {
        await db().delete(campaigns).where(eq(campaigns.id, campaign_id));
        return { url: BLOB_URL };
      });

      const res = await submit(token, photo([PNG], "image/png", "a.png"));

      expect(res.init.status).toBe(404);
      expect(res.data).toEqual({ state: "gone" });
      // the file is stored before the banner write rechecks the campaign, then removed
      expect(put).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith(BLOB_URL, { token: "tok" });
    });

    const ended_after_link = {
      "ended from the dashboard": { status: "ended" as const },
      "past its end date": {
        ends_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
    };

    test.each(Object.entries(ended_after_link))(
      "a campaign %s after the link was made is the generic 404, before anything is stored",
      async (_, set) => {
        const { token, campaign_id } = await seed();
        await db()
          .update(campaigns)
          .set(set)
          .where(eq(campaigns.id, campaign_id));

        const page = await get(token);
        const res = await submit(token, photo([PNG], "image/png", "a.png"));

        for (const r of [page, res]) {
          expect(r.init.status).toBe(404);
          expect(r.data).toEqual({ state: "gone" });
        }
        expect(html_of(page.data)).toContain(GONE);
        expect(put).not.toHaveBeenCalled();
        expect(await used_at_of()).toBeNull();
        expect(await banner_of(campaign_id)).toBe(
          "https://blob.test/u/old.png"
        );
      }
    );

    test("a campaign that ends while the photo is uploading keeps its banner, and the stored file is removed", async () => {
      const { token, campaign_id } = await seed();
      put.mockImplementationOnce(async () => {
        await db()
          .update(campaigns)
          .set({ status: "ended" })
          .where(eq(campaigns.id, campaign_id));
        return { url: BLOB_URL };
      });

      const res = await submit(token, photo([PNG], "image/png", "a.png"));

      expect(res.init.status).toBe(404);
      expect(res.data).toEqual({ state: "gone" });
      expect(await banner_of(campaign_id)).toBe("https://blob.test/u/old.png");
      expect(del).toHaveBeenCalledWith(BLOB_URL, { token: "tok" });
      expect(await used_at_of()).toBeNull();
      // the removed file is never offered as this campaign's hero
      const [link] = await db().select().from(connector_photo_links);
      expect(link).toMatchObject({ saved_url: null, saved_pathname: null });
      expect(html_of({ state: "gone" }, res.data)).toContain(GONE);
    });

    test("the 31st post in a minute from one address is 429, another address still passes", async () => {
      const { token } = await seed();
      for (let i = 0; i < 30; i++) {
        const res = await submit(token, null, { ip: "203.0.113.50" });
        expect(res.init.status).toBe(400);
      }

      const limited = await submit(token, photo([PNG], "image/png", "a.png"), {
        ip: "203.0.113.50",
      });
      expect(limited.init.status).toBe(429);
      expect(limited.data).toEqual({ state: "limited" });
      expect(put).not.toHaveBeenCalled();
      expect(html_of({ state: "gone" }, limited.data)).toContain(
        "Wait a minute"
      );

      const other = await submit(token, photo([PNG], "image/png", "a.png"), {
        ip: "203.0.113.51",
      });
      expect(other.data).toMatchObject({ state: "saved" });
    });
  }
);

describe("picking a photo in the browser", () => {
  type Pick = { size: number; type: string; name: string };
  const PICK: Pick = { size: 1000, type: "image/png", name: "a.png" };
  /** no reportValidity on purpose: the page's own alert shows the hold, so a
   * call to the native bubble throws here */
  const input = (pick?: Partial<Pick>) => {
    const state = { validity: "" };
    return {
      state,
      files: pick === undefined ? [] : [{ ...PICK, ...pick }],
      setCustomValidity: (m: string) => {
        state.validity = m;
      },
    };
  };

  test("a photo past the cap is held with the server's own 413 copy, one of exactly the cap clears it", async () => {
    const { token } = await seed();
    const big = input({ size: upload_limits.max_bytes + 1 });

    expect(route.hold_unfit(big)).toBe(true);

    const server = await submit(
      token,
      photo(
        [PNG, new Uint8Array(upload_limits.max_bytes)],
        "image/png",
        "a.png"
      )
    );
    expect(server.init.status).toBe(413);
    expect(big.state.validity).toBe(server.data.error);

    const fits = Object.assign(big, {
      files: [{ ...PICK, size: upload_limits.max_bytes }],
    });
    expect(route.hold_unfit(fits)).toBe(false);
    expect(fits.state.validity).toBe("");
  });

  test.each([
    ["a heic", { type: "image/heic", name: "IMG_1.HEIC" }],
    ["a pdf", { type: "application/pdf", name: "flyer.pdf" }],
    ["an svg", { type: "image/svg+xml", name: "logo.svg" }],
    ["an untyped .heic", { type: "", name: "IMG_1.heic" }],
    ["an untyped file with no extension", { type: "", name: "photo" }],
  ])("%s is held as the wrong type", (_, pick) => {
    const el = input(pick);

    expect(route.hold_unfit(el)).toBe(true);
    expect(el.state.validity).toBe(photo_wrong_type);
  });

  test.each<[string, Partial<Pick>]>([
    ...photo_types.map((type): [string, Partial<Pick>] => [
      type,
      { type, name: "a" },
    ]),
    ["an untyped .JPG", { type: "", name: "IMG_1.JPG" }],
    ["an untyped .jpeg", { type: "", name: "a.jpeg" }],
    ["an untyped .png", { type: "", name: "a.png" }],
    ["an untyped .webp", { type: "", name: "a.webp" }],
  ])("%s passes, clearing an earlier hold", (_, pick) => {
    const el = input({ type: "image/heic", name: "a.heic" });
    route.hold_unfit(el);

    const fits = Object.assign(el, { files: [{ ...PICK, ...pick }] });
    expect(route.hold_unfit(fits)).toBe(false);
    expect(fits.state.validity).toBe("");
  });

  test("while the photo is on its way the page shows the bytes sent and holds the button, so a second press can't spend the link", () => {
    const html = markup(
      createMemoryRouter([
        {
          path: "/",
          Component: () =>
            createElement(PhotoUploadPage, {
              view: {
                state: "uploading",
                campaign: "Library drive",
                file_name: "a.png",
                preview_url: "blob:https://bg.test/1",
                loaded: Math.round(2.46 * MIB),
                total: Math.round(3.949 * MIB),
              },
            }),
        },
      ])
    );

    expect(html).toContain("2.5 of 3.9 MB");
    expect(html).toContain("62%");
    expect(html).toContain('src="blob:https://bg.test/1"');
    const button = /<button[^>]*>/.exec(html)?.[0] ?? "";
    // held without `disabled`, which would blur the button the press focused
    expect(button).toContain('aria-disabled="true"');
    expect(button).toContain("pending");
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
  });

  test("clearing the pick clears the hold", () => {
    const none = input({ size: upload_limits.max_bytes + 1 });
    route.hold_unfit(none);
    expect(route.hold_unfit(Object.assign(none, { files: [] }))).toBe(false);
    expect(none.state.validity).toBe("");
  });
});

describe("the upload script", () => {
  class FakeXhr {
    static last: FakeXhr;
    upload = {
      onprogress: null as null | ((e: Partial<ProgressEvent>) => void),
      onload: null as null | (() => void),
    };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    onabort: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    sent: { method?: string; url?: string; body?: unknown } = {};
    headers: Record<string, string> = {};
    responseText = "";
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      Object.assign(this.sent, { method, url });
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    send(body: unknown) {
      this.sent.body = body;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const URL_ = "https://bg.test/photo-upload/tok";

  test("posts the form as json, reports bytes sent, and answers with the server's page", async () => {
    const form = new FormData();
    const progress = vi.fn();

    const answer = route.send_photo(URL_, form, "Library drive", progress);
    const xhr = FakeXhr.last;
    expect(xhr.sent).toEqual({ method: "POST", url: URL_, body: form });
    expect(xhr.headers.accept).toBe("application/json");

    xhr.upload.onprogress!({ lengthComputable: false, loaded: 5, total: 0 });
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 40, total: 100 });
    expect(progress.mock.calls).toEqual([[40, 100]]);

    xhr.responseText = JSON.stringify({
      state: "ready",
      campaign: "Library drive",
      error: "Choose a JPEG, PNG or WebP photo.",
    });
    xhr.onload!();
    expect(await answer).toEqual({
      state: "ready",
      campaign: "Library drive",
      error: "Choose a JPEG, PNG or WebP photo.",
    });
  });

  test("a save the server couldn't confirm reads as unconfirmed, not as a failure to retry", async () => {
    const answer = route.send_photo(
      URL_,
      new FormData(),
      "Library drive",
      () => {}
    );

    const xhr = FakeXhr.last;
    xhr.responseText = JSON.stringify({
      state: "unknown",
      campaign: "Library drive",
    });
    xhr.onload!();

    const page = await answer;
    expect(page).toEqual({ state: "unknown", campaign: "Library drive" });
    const html = html_of({ state: "ready", campaign: "Library drive" }, page);
    expect(html).toContain(UNCONFIRMED_TITLE);
    expect(html).toContain(UNCONFIRMED_LEDE);
  });

  const send = () =>
    route.send_photo(URL_, new FormData(), "Library drive", () => {});

  const lost = {
    "the connection drops": (x: FakeXhr) => x.onerror!(),
    "the request is aborted": (x: FakeXhr) => x.onabort!(),
    "the request times out": (x: FakeXhr) => x.ontimeout!(),
  };
  const sending = {
    "before any of the photo is sent": (_: FakeXhr) => {},
    "partway through the photo": (x: FakeXhr) =>
      x.upload.onprogress!({ lengthComputable: true, loaded: 40, total: 100 }),
  };
  const sent = {
    "once the photo is sent": (x: FakeXhr) => x.upload.onload!(),
    "once progress reaches the whole body": (x: FakeXhr) =>
      x.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 }),
  };
  const cases = (phases: object, ends: object) =>
    Object.entries(phases).flatMap(([phase, at]) =>
      Object.entries(ends).map(
        ([how, end]) =>
          [how, phase, at, end] as [
            string,
            string,
            (x: FakeXhr) => void,
            (x: FakeXhr) => void,
          ]
      )
    );

  test.each(cases(sending, lost))(
    "when %s %s, nothing reached the server and the page reads failed",
    async (_, __, at, end) => {
      const answer = send();

      at(FakeXhr.last);
      end(FakeXhr.last);

      expect(await answer).toEqual({
        state: "failed",
        campaign: "Library drive",
      });
    }
  );

  test.each(cases(sent, lost))(
    "when %s %s, the save may have landed and the page reads unconfirmed",
    async (_, __, at, end) => {
      const answer = send();

      at(FakeXhr.last);
      end(FakeXhr.last);

      expect(await answer).toEqual({
        state: "unknown",
        campaign: "Library drive",
      });
    }
  );

  test.each([
    [
      "the platform's own html page",
      "<!doctype html><h1>504 Gateway Timeout</h1>",
    ],
    ["json that isn't a page", JSON.stringify({ error: "nope" })],
  ])(
    "an answer that is %s reads unconfirmed: the save behind it may have landed",
    async (_, body) => {
      const answer = send();

      const xhr = FakeXhr.last;
      xhr.upload.onload!();
      xhr.responseText = body;
      xhr.onload!();

      expect(await answer).toEqual({
        state: "unknown",
        campaign: "Library drive",
      });
    }
  );
});

describe("as a document request", () => {
  const handler = createStaticHandler([
    {
      id: "photo",
      path: "/photo-upload/:token",
      loader: route.loader as any,
      action: route.action as any,
    },
  ]);

  test("a saved photo answers 200, and the rerun loader reads the spent link as saved", async () => {
    const { token } = await seed();
    const form = new FormData();
    form.set("photo", photo([PNG], "image/png", "a.png"));

    const context = await handler.query(
      new Request(`https://bg.test/photo-upload/${token}`, {
        method: "POST",
        body: form,
      })
    );

    if (context instanceof Response) throw new Error("unexpected response");
    const saved = {
      state: "saved",
      campaign: "Library drive",
      photo: BLOB_URL,
    };
    expect(context.loaderData.photo).toEqual(saved);
    expect(context.actionData?.photo).toEqual(saved);
    expect(context.statusCode).toBe(200);
  });
});

describe("every response from this page", () => {
  test("is no-store, sends no referrer, and is not indexed", () => {
    const headers = new Headers((route.headers as () => HeadersInit)());
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-robots-tag")).toBe("noindex");
    expect((route.meta as () => unknown[])()).toContainEqual({
      name: "robots",
      content: "noindex",
    });
  });

  test("the generic 404 for a dead link carries them", async () => {
    const res = await serve(new Request("https://bg.test/photo-upload/nope"));

    expect(res.status).toBe(404);
    no_leak(res);
  });

  test("a loader that throws lands on this route's boundary, with them", async () => {
    const res = await serve(new Request("https://bg.test/photo-upload/any"), {
      ...route,
      loader: () => {
        throw new Error("db down");
      },
    });

    expect(res.status).toBe(500);
    no_leak(res);
  });

  test("a live page load carries them, and asking for json still gets the document, never the upload", async () => {
    const { token } = await seed();

    const res = await serve(
      new Request(`https://bg.test/photo-upload/${token}`, {
        headers: { accept: "application/json" },
      })
    );

    expect(res.status).toBe(200);
    no_leak(res);
    expect(res.headers.has(RENDERED)).toBe(true);
    expect(await res.json()).toEqual({
      state: "ready",
      campaign: "Library drive",
    });
    expect(await used_at_of()).toBeNull();
  });
});
