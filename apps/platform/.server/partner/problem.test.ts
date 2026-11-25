import { describe, expect, test } from "vitest";
import {
  below_minimum,
  PROBLEM_CODES,
  problem,
  provider_error,
  rate_limited,
} from "./problem";

const read = async (res: Response) => ({
  status: res.status,
  type: res.headers.get("content-type"),
  cache: res.headers.get("cache-control"),
  body: await res.json(),
});

describe("problem", () => {
  test.each([
    ["key_invalid", 401],
    ["invalid_request", 400],
    ["not_found", 404],
    ["idempotency_conflict", 409],
    ["fee_not_ready", 409],
    ["authorization_expired", 410],
    ["unsupported", 422],
    ["coin_not_accepted", 422],
    ["above_maximum", 422],
  ] as const)(
    "%s answers %i as uncached problem json",
    async (code, status) => {
      const res = await read(problem(code));
      expect(res).toMatchObject({
        status,
        type: "application/problem+json",
        cache: "no-store",
        body: { code, status, error: { code } },
      });
      expect(res.body.error.message).toEqual(expect.any(String));
    }
  );

  test("detail replaces the default message, and field errors ride along", async () => {
    const res = await read(
      problem("invalid_request", {
        detail: "amount_minor is a whole number",
        errors: [{ path: "amount_minor", message: "is a whole number" }],
      })
    );
    expect(res.body).toEqual({
      code: "invalid_request",
      status: 400,
      detail: "amount_minor is a whole number",
      errors: [{ path: "amount_minor", message: "is a whole number" }],
      error: {
        code: "invalid_request",
        message: "amount_minor is a whole number",
      },
    });
  });

  test("below_minimum carries minimum_minor", async () => {
    const res = await read(below_minimum(500));
    expect(res).toMatchObject({
      status: 422,
      body: { code: "below_minimum", minimum_minor: 500 },
    });
  });

  test("rate_limited carries retry-after in whole seconds", async () => {
    const res = rate_limited(17);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect((await res.json()).code).toBe("rate_limited");
  });

  test("provider_error takes its 5xx", async () => {
    expect((await read(provider_error(503))).body).toMatchObject({
      code: "provider_error",
      status: 503,
    });
  });

  // a code is wire contract: dropping or renaming one breaks an integrator
  test("the code set is the contract's", () => {
    expect([...PROBLEM_CODES].sort()).toEqual(
      [
        "key_invalid",
        "invalid_request",
        "not_found",
        "idempotency_conflict",
        "fee_not_ready",
        "authorization_expired",
        "unsupported",
        "coin_not_accepted",
        "below_minimum",
        "above_maximum",
        "rate_limited",
        "provider_error",
      ].sort()
    );
  });
});
