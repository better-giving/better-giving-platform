import { resolve } from "node:path";
import { data, matchPath, matchRoutes, redirect } from "react-router";
import { createFormData } from "remix-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const forwarded = vi.hoisted(() => ({
  fields: [] as [string, string][],
  answer: { ok: true } as unknown,
}));
vi.mock("#/routes/admin.$id.organization.videos/api", () => ({
  videos_action: vi.fn(async (x: { request: Request }) => {
    forwarded.fields = [...(await x.request.formData())] as [string, string][];
    return forwarded.answer;
  }),
}));
vi.mock("#/.server/toast", () => ({
  redirectWithSuccess: vi.fn((url: string, message: string) =>
    redirect(url, { headers: { "x-toast": message } })
  ),
}));

beforeEach(() => {
  forwarded.answer = { ok: true };
});

import { action, loader } from "./route";

const VIDEOS = "/admin/7/organization#videos";

describe("retired Media page", () => {
  it.each([
    "/admin/7/media",
    "/admin/7/media/new",
    "/admin/7/media/0b6f7c1e-0000-4000-8000-000000000000",
  ])("%s lands on the organization screen's Videos group", (path) => {
    const m = matchPath("/admin/:id/media/*", path);
    expect(m).not.toBeNull();
    const res = loader({ params: m!.params } as never) as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(VIDEOS);
  });

  /** a Media tab loaded before this route redirected */
  const old_post = (path: string, body: FormData) =>
    (action as any)({
      request: new Request(`http://x${path}`, { method: "POST", body }),
      params: matchPath("/admin/:id/media/*", path)!.params,
      context: { get: () => 7 },
    });

  it("forwards an old list press as it was sent", async () => {
    const fd = new FormData();
    fd.set("featured", "1");
    fd.set("mediaId", "m1");
    fd.set("intent", "feature");
    expect(await old_post("/admin/7/media", fd)).toEqual({ ok: true });
    expect(forwarded.fields).toEqual([
      ["featured", "1"],
      ["mediaId", "m1"],
      ["intent", "feature"],
    ]);
  });

  it("an old dialog's save leaves for the Videos group with its toast", async () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    forwarded.answer = { ok: true, id: "m2" };
    const added = await old_post("/admin/7/media/new", createFormData({ url }));
    expect(added).toBeInstanceOf(Response);
    expect(added.headers.get("location")).toBe(VIDEOS);
    expect(added.headers.get("x-toast")).toBe("Video added");

    forwarded.answer = { ok: true };
    const edited = await old_post("/admin/7/media/m1", createFormData({ url }));
    expect(edited.headers.get("location")).toBe(VIDEOS);
    expect(edited.headers.get("x-toast")).toBe("Video updated");
  });

  /** the dialog's `useRemixForm` reads `errors` as react-hook-form field errors */
  it.each([
    [
      data(
        { errors: { url: "only YouTube links are supported" } },
        { status: 400 }
      ),
      "only YouTube links are supported",
      400,
    ],
    [
      data({ error: "Video not found" }, { status: 404 }),
      "Video not found",
      404,
    ],
  ])(
    "an old dialog's refused save comes back under its link field (%#)",
    async (answer, message, status) => {
      forwarded.answer = answer;
      const url = "https://youtu.be/dQw4w9WgXcQ";
      const res = await old_post("/admin/7/media/m1", createFormData({ url }));
      expect(res.data).toEqual({
        errors: { url: { message, type: "custom" } },
      });
      expect(res.init.status).toBe(status);
    }
  );

  it("forwards an old add and edit dialog's save as the add and edit intents", async () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    // the dialog posted through remix-hook-form, which JSON-encodes each value
    await old_post("/admin/7/media/new", createFormData({ url }));
    expect(forwarded.fields).toEqual([
      ["intent", "add"],
      ["url", url],
    ]);

    await old_post("/admin/7/media/m1", createFormData({ url }));
    expect(forwarded.fields).toEqual([
      ["intent", "edit"],
      ["url", url],
      ["mediaId", "m1"],
    ]);
  });
});

describe("the real route table", () => {
  it.each([
    "/admin/7/media",
    "/admin/7/media/new",
    "/admin/7/media/0b6f7c1e-0000-4000-8000-000000000000",
  ])("%s is answered by this splat route", async (path) => {
    // what `react-router dev` sets before it loads src/routes.ts
    (globalThis as any).__reactRouterAppDirectory = resolve(
      import.meta.dirname,
      "../.."
    );
    const table = await (await import("../../routes.ts")).default;

    const matches = matchRoutes(table as never, path);
    expect(matches?.at(-1)?.route).toMatchObject({
      file: "routes/admin.$id.media.$/route.ts",
    });
  });
});
