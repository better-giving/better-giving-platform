import { describe, expect, test } from "vitest";
import { loader } from "./[.well-known].api-catalog";
import { loader as openapi } from "./[openapi.json]";
import { loader as guide } from "./agents._index";

const get = (method: string) =>
  loader({
    request: new Request(
      "https://preview.better.giving/.well-known/api-catalog",
      {
        method,
      }
    ),
    params: {},
    context: {},
  } as never) as Response;

describe("/.well-known/api-catalog", () => {
  test("links each API to its OpenAPI document and its guide (RFC 9727)", async () => {
    const res = get("GET");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    const origin = "https://preview.better.giving";
    const link = {
      "service-desc": [
        { href: `${origin}/openapi.json`, type: "application/json" },
      ],
      "service-doc": [{ href: `${origin}/agents`, type: "text/markdown" }],
    };
    expect(await res.json()).toEqual({
      linkset: [
        { anchor: `${origin}/api`, ...link },
        { anchor: `${origin}/connector/v1`, ...link },
      ],
    });
  });

  test("each advertised type is the media type its target serves", async () => {
    const served = async (
      handler: (args: never) => unknown,
      path: string
    ): Promise<string | undefined> => {
      const res = (await handler({
        request: new Request(`https://preview.better.giving${path}`),
        params: {},
        context: {},
      } as never)) as Response;
      return res.headers.get("content-type")?.split(";")[0];
    };
    const { linkset } = await get("GET").json();

    expect(linkset[0]["service-desc"][0].type).toBe(
      await served(openapi, "/openapi.json")
    );
    expect(linkset[0]["service-doc"][0].type).toBe(
      await served(guide, "/agents")
    );
  });

  test("a HEAD names the catalog in its Link header", () => {
    expect(get("HEAD").headers.get("link")).toBe(
      '<https://preview.better.giving/.well-known/api-catalog>; rel="api-catalog"'
    );
  });
});
