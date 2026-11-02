import { describe, expect, it } from "vitest";
import { headers, loader } from "./api";

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as Response;
  }
  throw new Error("loader did not throw");
};

const call = (request: Request, url: URL) =>
  loader({ request, url, params: {} } as never);

describe("home tracking-param redirect", () => {
  it("drops tracking params and keeps the rest", () => {
    const href = "https://x/?utm_source=nl&ref=a";
    const res = thrown(() => call(new Request(href), new URL(href)));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/?ref=a");
  });

  it("redirects a data request to the same place as the document", () => {
    // a client navigation to `/` asks for `/_root.data`, with `_routes` left in
    const raw = new Request(
      "https://x/_root.data?utm_source=nl&ref=a&_routes=routes%2F_landing._index"
    );
    const res = thrown(() =>
      call(raw, new URL("https://x/?utm_source=nl&ref=a"))
    );
    expect(res.headers.get("location")).toBe("/?ref=a");
  });

  it("serves the page when nothing needs stripping", () => {
    const href = "https://x/?ref=a";
    expect(call(new Request(href), new URL(href))).toBeNull();
  });
});

describe("home discovery links", () => {
  it("advertises the api catalog, openapi, markdown twin and mcp card", () => {
    const { link } = (headers as unknown as () => Record<string, string>)();
    expect(link.split(", ")).toEqual([
      '</.well-known/api-catalog>; rel="api-catalog"',
      '</openapi.json>; rel="service-desc"; type="application/json"',
      '</index.md>; rel="alternate"; type="text/markdown"',
      '</.well-known/mcp.json>; rel="mcp"; type="application/json"',
    ]);
  });
});
