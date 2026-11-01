import { describe, expect, test } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { loader } from "./[openapi.json]";

describe("/openapi.json", () => {
  test("serves an OpenAPI 3.1 document for the request origin", async () => {
    const res = (await loader({
      ...doc_args(new Request("https://preview.better.giving/openapi.json")),
      params: {},
      context: {},
    } as never)) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0].url).toBe("https://preview.better.giving");
    expect(doc.info.contact.url).toBe("https://preview.better.giving/agents");
  });
});
