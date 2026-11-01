import { describe, expect, test } from "vitest";
import { action, loader } from "./api.$";

describe("unknown path under /api", () => {
  // before: react-router matched no route and rendered the root's html 404
  test.each([
    ["loader (GET, HEAD)", loader],
    ["action (any other method)", action],
  ] as const)("the %s answers a not_found json error", async (_, fn) => {
    const res = fn();

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "not_found",
        message: "No API endpoint matches this path.",
      },
    });
  });
});
