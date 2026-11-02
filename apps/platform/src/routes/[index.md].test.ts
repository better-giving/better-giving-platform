import { afterEach, describe, expect, test, vi } from "vitest";
import { loader } from "./[index.md]";

const call = () =>
  loader({
    url: new URL("https://preview.better.giving/index.md"),
  } as never) as Promise<Response>;

afterEach(() => vi.unstubAllGlobals());

describe("/index.md", () => {
  test("serves the homepage's markdown rendering", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("---\ntitle: x\n---\n\n# Home\n", {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        })
    );
    vi.stubGlobal("fetch", fetch);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(await res.text()).toBe("---\ntitle: x\n---\n\n# Home\n");
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://preview.better.giving/");
    expect(init.headers).toEqual({ accept: "text/markdown" });
  });

  test("answers 502 when the page did not come back as markdown", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>", { headers: { "content-type": "text/html" } })
    );
    expect((await call()).status).toBe(502);
  });
});
