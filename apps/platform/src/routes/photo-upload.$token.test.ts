import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  createRequestHandler,
  createStaticHandler,
  RouterProvider,
  type ServerBuild,
  useActionData,
  useLoaderData,
} from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { upload_limits } from "@/constants/upload";
import { issue_photo_link } from "$/connector/photo-links";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { campaigns } from "$/pg/schema/campaign";
import { connector_photo_links } from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";
import * as route from "./photo-upload.$token";

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
  "This upload link has expired or was already used. Ask for a new one.";

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

const submit = async (
  token: string,
  file: File | string | null,
  init: { ip?: string; headers?: Record<string, string> } = {}
) => {
  const form = new FormData();
  if (file !== null) form.set("photo", file);
  const request = new Request(`https://bg.test/photo-upload/${token}`, {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": init.ip ?? "203.0.113.9", ...init.headers },
  });
  return (await route.action({
    request,
    params: { token },
    context: {},
  } as unknown as Parameters<typeof route.action>[0])) as unknown as Result;
};

/** the page in a data router, as `<Form>` and `useNavigation` need; its
 * action never settles, so a submit stays in flight */
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
        action: () => new Promise(() => {}),
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

  test("unknown, malformed, expired and used links are one identical 404", async () => {
    const { token } = await seed();
    const unknown = await get("A".repeat(43));
    const malformed = await get("not a token");

    await db()
      .update(connector_photo_links)
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const expired = await get(token);

    const fresh = await seed2();
    await submit(fresh.token, photo([PNG], "image/png", "a.png"));
    const used = await get(fresh.token);

    for (const res of [unknown, malformed, expired, used]) {
      expect(res.init.status).toBe(404);
      expect(res.data).toEqual({ state: "gone" });
    }
    const html = html_of(unknown.data);
    expect(html).toContain(GONE);
    expect(html).not.toContain("<form");
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

describe("POST /photo-upload/:token", () => {
  test("a png becomes the banner, the link is spent, and a second post changes nothing", async () => {
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
    expect(html).toContain("close this tab");

    put.mockResolvedValue({ url: "https://blob.test/u/second.png" });
    const again = await submit(token, photo([PNG], "image/png", "b.png"));
    expect(again.init.status).toBe(404);
    expect(again.data).toEqual({ state: "gone" });
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

  test.each([
    ["pdf bytes declared pdf", ["%PDF-1.7\n"], "application/pdf", "a.pdf", 415],
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
    expect(failed.data).toEqual({ state: "failed", campaign: "Library drive" });
    expect(await used_at_of()).toBeNull();
    expect(await banner_of(campaign_id)).toBe("https://blob.test/u/old.png");
    const html = html_of({ state: "gone" }, failed.data);
    expect(html).toContain("couldn't be saved");
    expect(html).toContain('name="photo"');

    const ok = await submit(token, photo([PNG], "image/png", "a.png"));
    expect(ok.data).toMatchObject({ state: "saved" });
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
    // the file is stored before the campaign is checked, then removed
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
      expect(await banner_of(campaign_id)).toBe("https://blob.test/u/old.png");
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
    expect(html_of({ state: "gone" }, limited.data)).toContain("Wait a minute");

    const other = await submit(token, photo([PNG], "image/png", "a.png"), {
      ip: "203.0.113.51",
    });
    expect(other.data).toMatchObject({ state: "saved" });
  });
});

describe("picking a photo in the browser", () => {
  const input = (size?: number) => {
    const state = { validity: "", reported: 0 };
    return {
      state,
      files: size === undefined ? [] : [{ size }],
      setCustomValidity: (m: string) => {
        state.validity = m;
      },
      reportValidity: () => {
        state.reported++;
        return state.validity === "";
      },
    };
  };

  test("a photo past the cap holds the form with the server's own 413 copy, a smaller pick clears it", async () => {
    const { token } = await seed();
    const big = input(upload_limits.max_bytes + 1);

    route.hold_oversized(big);

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
    expect(big.state.reported).toBe(1);

    const fits = Object.assign(big, {
      files: [{ size: upload_limits.max_bytes }],
    });
    route.hold_oversized(fits);
    expect(fits.state.validity).toBe("");
  });

  test("the upload button is held while the photo is on its way, so a second press can't spend the link", async () => {
    const router = router_of({ state: "ready", campaign: "Library drive" });
    const button = () => /<button[^>]*>/.exec(markup(router))?.[0] ?? "";
    expect(button()).not.toContain("aria-disabled");

    const form = new FormData();
    form.set("photo", photo([PNG], "image/png", "a.png"));
    void router.navigate("/p", {
      formMethod: "post",
      formEncType: "multipart/form-data",
      formData: form,
    });
    await vi.waitFor(() =>
      expect(router.state.navigation.state).toBe("submitting")
    );

    expect(button()).toContain('aria-disabled="true"');
    router.dispose();
  });

  test("clearing the pick clears the hold", () => {
    const none = input(upload_limits.max_bytes + 1);
    route.hold_oversized(none);
    route.hold_oversized(Object.assign(none, { files: [] }));
    expect(none.state.validity).toBe("");
  });
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

  test("a saved photo answers 200 though the rerun loader now reads the link as spent", async () => {
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
    expect(context.loaderData.photo).toEqual({ state: "gone" });
    expect(context.actionData?.photo).toMatchObject({ state: "saved" });
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

  // the framework merges a route's `headers` export into the document
  // response; this runs that merge on a hand-built server build, with the
  // real route module and a loader that can be swapped for one that throws
  const document_headers = async (
    url: string,
    loader: unknown = route.loader
  ) => {
    const mod = { ...route, loader } as any;
    const build = {
      entry: {
        module: {
          default: (_req: Request, status: number, headers: Headers) =>
            new Response(null, { status, headers }),
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
      future: {},
      ssr: true,
      isSpaMode: false,
      prerender: [],
      routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
    } as unknown as ServerBuild;
    return createRequestHandler(build, "test")(new Request(url));
  };

  const no_leak = (res: Response) => {
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  };

  test("the generic 404 for a dead link carries them", async () => {
    const res = await document_headers("https://bg.test/photo-upload/nope");

    expect(res.status).toBe(404);
    no_leak(res);
  });

  test("a loader that throws lands on this route's boundary, with them", async () => {
    const res = await document_headers(
      "https://bg.test/photo-upload/any",
      () => {
        throw new Error("db down");
      }
    );

    expect(res.status).toBe(500);
    no_leak(res);
  });
});
