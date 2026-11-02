import { describe, expect, test } from "vitest";
import {
  FILTERED_HEADERS,
  SECRETS,
  vercel_event,
} from "#/__tests__/fixtures/sentry-request";
import { scrub_event, scrub_url } from "./scrub-event";

const F = "[Filtered]";

describe("scrub_event", () => {
  test("keeps allowlisted header values, whatever their case, and filters every other one", () => {
    expect(scrub_event(vercel_event()).request.headers).toEqual(
      FILTERED_HEADERS
    );
  });

  test("filters every cookie value and drops env and the request body", () => {
    const out = scrub_event(vercel_event()).request as Record<string, unknown>;
    expect(out.cookies).toEqual({
      "__Secure-better-auth.session_token": F,
      theme: F,
    });
    expect(out).not.toHaveProperty("env");
    expect(out).not.toHaveProperty("data");
  });

  test("filters credential query params in the url and query string", () => {
    const out = scrub_event(vercel_event()).request;
    expect(out.query_string).toBe(
      `page=2&access_token=${F}&x-vercel-protection-bypass=${F}`
    );
    expect(out.url).toBe(
      `https://www.better.giving/api/x?page=2&access_token=${F}&x-vercel-protection-bypass=${F}#top`
    );
  });

  test("filters credential params in an outgoing request breadcrumb's query", () => {
    const [crumb] = scrub_event(vercel_event()).breadcrumbs;
    expect(crumb!.data["http.query"]).toBe(`?symbol=AAPL&token=${F}`);
    expect(crumb!.data.url).toBe("https://finnhub.io/api/v1/quote");
  });

  test("leaves no secret anywhere in the event", () => {
    const json = JSON.stringify(scrub_event(vercel_event()));
    for (const secret of SECRETS) expect(json, secret).not.toContain(secret);
  });

  test("filters credential names in object and pair query params, keeps the rest", () => {
    expect(
      scrub_event({
        request: { query_string: { apiKey: "k", page: "2", oauth_code: "c" } },
      }).request.query_string
    ).toEqual({ apiKey: F, page: "2", oauth_code: F });
    expect(
      scrub_event({
        request: {
          query_string: [
            ["sig", "s"],
            ["campaign", "c1"],
          ],
        },
      }).request.query_string
    ).toEqual([
      ["sig", F],
      ["campaign", "c1"],
    ]);
  });

  test("leaves the original event untouched", () => {
    const event = { ...vercel_event(), message: "boom" };
    const before = JSON.stringify(event);
    const out = scrub_event(event);
    expect(JSON.stringify(event)).toBe(before);
    expect(out.message).toBe("boom");
    expect(scrub_event({ message: "no request", request: undefined })).toEqual({
      message: "no request",
      request: undefined,
    });
  });
});

describe("scrub_url", () => {
  test.each([
    "token",
    "secret",
    "key",
    "apikey",
    "sig",
    "signature",
    "auth",
    "authorization",
    "password",
    "session",
    "code",
    "jwt",
    "otp",
    "bypass",
    "credential",
    "credentials",
  ])("filters a param named for %s, alone and inside a longer name", (word) => {
    expect(scrub_url(`/a?${word}=v&x_${word}_y=v&page=2`)).toBe(
      `/a?${word}=${F}&x_${word}_y=${F}&page=2`
    );
  });

  test("splits camelCase names into words", () => {
    expect(
      scrub_url("/a?accessToken=v&clientSecret=v&sessionId=v&pageSize=20")
    ).toBe(`/a?accessToken=${F}&clientSecret=${F}&sessionId=${F}&pageSize=20`);
  });

  test("returns a url with no query string as it is", () => {
    for (const url of [
      "https://www.better.giving/donate/123",
      "/photo-upload/abc#top",
      "https://www.better.giving/reset-password/abc",
      "",
    ]) {
      expect(scrub_url(url)).toBe(url);
    }
  });

  test("decodes a percent-encoded name, survives a malformed one, and filters a bare name", () => {
    expect(scrub_url("/a?%74oken=v")).toBe(`/a?%74oken=${F}`);
    expect(scrub_url("/a?%E0%A4%A=v&token=v")).toBe(`/a?%E0%A4%A=v&token=${F}`);
    expect(scrub_url("/a?token&page=2")).toBe(`/a?token=${F}&page=2`);
  });

  test("keeps names that only share letters with a credential word", () => {
    const url = "/a?keyboard=1&monkey=2&codename=3&page=4";
    expect(scrub_url(url)).toBe(url);
  });
});
