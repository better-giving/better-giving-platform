import { afterEach, describe, expect, test, vi } from "vitest";

const env = vi.hoisted(() => ({
  slack: { bot_token: "xoxb-stale" as string | undefined },
  stage: "test",
}));
vi.mock("../env", () => env);

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const refused = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ ok: false, error: "invalid_auth" }));

describe("the server's slack bots", () => {
  test("off production, a refused token resolves", async () => {
    env.stage = "staging";
    refused();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fiat_monitor } = await import("./slack");

    await expect(
      fiat_monitor.send_alert({ from: "t", title: "x" })
    ).resolves.toBeInstanceOf(Response);
  });

  test("on production, a refused token throws", async () => {
    env.stage = "production";
    refused();
    const { fiat_monitor } = await import("./slack");

    await expect(
      fiat_monitor.send_alert({ from: "t", title: "x" })
    ).rejects.toThrow("slack invalid_auth");
  });
});
