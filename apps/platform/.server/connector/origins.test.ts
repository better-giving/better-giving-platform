import { describe, expect, test } from "vitest";
import { origin_allowed } from "./origins";

describe("origin_allowed", () => {
  const env = {
    BASE_URL: "https://better.giving/app/",
    CONNECTOR_ORIGINS: " https://zap.example , , https://other.example:8443 ",
  };

  test("accepts the BASE_URL origin and a listed origin", () => {
    expect(origin_allowed("https://better.giving", env)).toBe(true);
    expect(origin_allowed("https://zap.example", env)).toBe(true);
    expect(origin_allowed("https://other.example:8443", env)).toBe(true);
  });

  test("rejects a different scheme, port, or host", () => {
    expect(origin_allowed("https://evil.example", env)).toBe(false);
    expect(origin_allowed("http://better.giving", env)).toBe(false);
    expect(origin_allowed("https://better.giving:444", env)).toBe(false);
    expect(origin_allowed("https://better.giving/app", env)).toBe(false);
  });

  test("a preview's own origin passes", () => {
    const preview = {
      BASE_URL: "https://better.giving",
      VERCEL_ENV: "preview",
      VERCEL_URL: "angelprotocol-web-hemp91g7w-better-giving.vercel.app",
      VERCEL_BRANCH_URL:
        "better-giving-git-cursor-connector-better-giving.vercel.app",
    };
    expect(
      origin_allowed(
        "https://angelprotocol-web-hemp91g7w-better-giving.vercel.app",
        preview
      )
    ).toBe(true);
    expect(
      origin_allowed(
        "https://better-giving-git-cursor-connector-better-giving.vercel.app",
        preview
      )
    ).toBe(true);
    expect(
      origin_allowed(
        "http://angelprotocol-web-hemp91g7w-better-giving.vercel.app",
        preview
      )
    ).toBe(false);
  });

  test("production refuses a foreign origin and a preview origin", () => {
    const production = {
      BASE_URL: "https://better.giving",
      VERCEL_ENV: "production",
      VERCEL_URL: "angelprotocol-web-hemp91g7w-better-giving.vercel.app",
      VERCEL_BRANCH_URL:
        "better-giving-git-cursor-connector-better-giving.vercel.app",
    };
    expect(origin_allowed("https://evil.example", production)).toBe(false);
    expect(
      origin_allowed(
        "https://angelprotocol-web-hemp91g7w-better-giving.vercel.app",
        production
      )
    ).toBe(false);
    expect(
      origin_allowed(
        "https://better-giving-git-cursor-connector-better-giving.vercel.app",
        production
      )
    ).toBe(false);
    expect(origin_allowed("https://better.giving", production)).toBe(true);
  });
});
