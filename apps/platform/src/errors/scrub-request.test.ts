import { describe, expect, test } from "vitest";
import {
  SAFE,
  SECRETS,
  vercel_request,
} from "#/__tests__/fixtures/sentry-request";
import { FILTERED, scrub_request } from "./scrub-request";

describe("scrub_request", () => {
  test("keeps allowlisted header values and filters every other one", () => {
    const raw = vercel_request();
    const out = scrub_request({ request: raw }).request!;
    for (const [name, value] of Object.entries(out.headers!)) {
      const expected = SAFE.includes(name.toLowerCase())
        ? raw.headers[name as keyof typeof raw.headers]
        : FILTERED;
      expect(value, name).toBe(expected);
    }
    expect(Object.keys(out.headers!)).toEqual(Object.keys(raw.headers));
  });

  test("filters every cookie value, drops env, and filters credential query params", () => {
    const out = scrub_request({ request: vercel_request() }).request!;
    expect(out.cookies).toEqual({
      "__Secure-better-auth.session_token": FILTERED,
      theme: FILTERED,
    });
    expect(out).not.toHaveProperty("env");
    expect(out.query_string).toBe(
      `page=2&access_token=${FILTERED}&x-vercel-protection-bypass=${FILTERED}`
    );
    expect(out.url).toBe(
      `https://www.better.giving/api/x?page=2&access_token=${FILTERED}&x-vercel-protection-bypass=${FILTERED}#top`
    );
    const json = JSON.stringify(out);
    for (const secret of SECRETS) expect(json, secret).not.toContain(secret);
  });

  test("filters credential names in object and pair query params, keeps the rest", () => {
    expect(
      scrub_request({
        request: { query_string: { apiKey: "k", page: "2", oauth_code: "c" } },
      }).request!.query_string
    ).toEqual({ apiKey: FILTERED, page: "2", oauth_code: FILTERED });
    expect(
      scrub_request({
        request: {
          query_string: [
            ["sig", "s"],
            ["campaign", "c1"],
          ],
        },
      }).request!.query_string
    ).toEqual([
      ["sig", FILTERED],
      ["campaign", "c1"],
    ]);
  });

  test("leaves the original event untouched and an event with no request as it is", () => {
    const event = { request: vercel_request(), message: "boom" };
    const before = JSON.stringify(event);
    const out = scrub_request(event);
    expect(JSON.stringify(event)).toBe(before);
    expect(out.message).toBe("boom");
    const bare = { message: "no request", request: undefined };
    expect(scrub_request(bare)).toBe(bare);
  });
});
