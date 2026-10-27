import { matchPath } from "react-router";
import { createFormData } from "remix-hook-form";
import { describe, expect, it, vi } from "vitest";

const forwarded = vi.hoisted(() => ({ fields: [] as [string, string][] }));
vi.mock("#/routes/admin.$id.organization.videos/api", () => ({
  videos_action: vi.fn(async (x: { request: Request }) => {
    forwarded.fields = [...(await x.request.formData())] as [string, string][];
    return { ok: true };
  }),
}));

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
