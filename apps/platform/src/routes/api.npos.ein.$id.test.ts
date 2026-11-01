import { describe, expect, test, vi } from "vitest";

const registered = { id: 7, registration_number: "123456789" };
vi.mock("$/pg/queries/npo", () => ({
  npo_by_regnum: async (ein: string) =>
    ein === registered.registration_number ? registered : null,
}));

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

  test("finds a dashed US EIN by its nine digits", async () => {
    for (const id of ["123456789", "12-3456789"]) {
      const res = await by_ein(id);

      expect(res.status, id).toBe(200);
      expect(await res.json(), id).toEqual(registered);
    }
  });

  test.each(["12-345", "1-23456789"])(
    "answers %s, a dash outside the NN-NNNNNNN shape, as before",
    async (id) => {
      const res = await by_ein(id);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "invalid_request",
          message: "must only contain letters and numbers",
        },
      });
    }
  );

  // before: an empty-bodied 404
  test("answers an unregistered ein with a not_found json error", async () => {
    const res = await by_ein("12345");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No nonprofit has this EIN." },
    });
  });
});
