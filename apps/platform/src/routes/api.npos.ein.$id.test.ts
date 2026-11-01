import { describe, expect, test, vi } from "vitest";

vi.mock("$/pg/queries/npo", () => ({ npo_by_regnum: async () => null }));

const { loader } = await import("./api.npos.ein.$id");

const by_ein = (id: string) =>
  loader({
    request: new Request(`https://x/api/npos/ein/${encodeURIComponent(id)}`),
    params: { id },
  } as any) as Promise<Response>;

describe("GET /api/npos/ein/:id", () => {
  // before: a thrown text/plain 400
  test("answers a non-alphanumeric ein with an invalid_request json error", async () => {
    const res = await by_ein("12-345");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "must only contain letters and numbers",
      },
    });
  });

  // before: an empty-bodied 404
  test("answers an unregistered ein with a not_found json error", async () => {
    const res = await by_ein("12345");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No nonprofit has this EIN." },
    });
  });
});
