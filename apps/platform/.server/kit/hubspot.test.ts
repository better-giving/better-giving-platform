import { afterEach, describe, expect, test, vi } from "vitest";

const env = vi.hoisted(() => ({
  hubspot: { access_token: "pat-stale" as string | undefined },
  stage: "test",
}));
vi.mock("../env", () => env);

const { crm } = await import("./hubspot");

// @hubspot/api-client's ApiException carries the http status as `code`
const unauthorized = () =>
  Object.assign(new Error("HTTP-Code: 401"), { code: 401 });

afterEach(() => {
  env.hubspot.access_token = "pat-stale";
  env.stage = "test";
  vi.restoreAllMocks();
});

describe("crm", () => {
  test("off production, a 401 resolves null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      crm("deal", () => Promise.reject(unauthorized()))
    ).resolves.toBeNull();
  });

  test("off production, a missing token resolves null without calling", async () => {
    env.hubspot.access_token = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = vi.fn();

    await expect(crm("deal", call)).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  test("off production, any other failure throws", async () => {
    const outage = Object.assign(new Error("HTTP-Code: 502"), { code: 502 });

    await expect(crm("deal", () => Promise.reject(outage))).rejects.toBe(
      outage
    );
  });

  test("on production, a 401 throws", async () => {
    env.stage = "production";

    await expect(
      crm("deal", () => Promise.reject(unauthorized()))
    ).rejects.toThrow("401");
  });

  test("on production, a missing token still calls and throws", async () => {
    env.stage = "production";
    env.hubspot.access_token = undefined;

    await expect(
      crm("deal", () => Promise.reject(unauthorized()))
    ).rejects.toThrow("401");
  });

  test("passes a result through", async () => {
    await expect(crm("deal", async () => ({ id: "1" }))).resolves.toEqual({
      id: "1",
    });
  });
});
