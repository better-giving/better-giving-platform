import { describe, expect, test } from "vitest";
import { loader } from "./registry.$";

const get = (splat: string) =>
  loader({ params: { "*": splat } } as never) as Response;

describe("/registry", () => {
  test("serves the index with cache and cors headers", async () => {
    const res = get("index.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await res.json();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.items.map((i: { name: string }) => i.name)).toContain("button");
  });

  test("serves an item with file bodies", async () => {
    const doc = await get("items/button.json").json();
    expect(doc.files[0].path).toBe("components/button.tsx");
    expect(doc.registryDependencies).toEqual(["tokens"]);
  });

  test("serves the cli as javascript", async () => {
    const res = get("cli.mjs");
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("bg-design");
  });

  test("unknown paths are 404", () => {
    expect(get("items/nope.json").status).toBe(404);
    expect(get("../../package.json").status).toBe(404);
  });
});
