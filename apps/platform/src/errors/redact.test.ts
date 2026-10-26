import { describe, expect, test } from "vitest";
import { redact, redact_text } from "./redact";

const TOKEN = "Zq3vY8pR2mK7tW1xN5bH9cJ4dF6gL0sA-_eUoIiPyQr";

describe("redact", () => {
  test("replaces the token in a path, a full url, and with a query or hash after it", () => {
    for (const [raw, out] of [
      [`/photo-upload/${TOKEN}`, "/photo-upload/[redacted]"],
      [
        `https://www.better.giving/photo-upload/${TOKEN}?_data=x`,
        "https://www.better.giving/photo-upload/[redacted]?_data=x",
      ],
      [
        `GET /photo-upload/${TOKEN}#top 404`,
        "GET /photo-upload/[redacted]#top 404",
      ],
      ["/photo-upload/", "/photo-upload/"],
      ["/campaigns/abc", "/campaigns/abc"],
    ]) {
      expect(redact_text(raw!)).toBe(out);
    }
  });

  // the shape `beforeSend` hands over: request, breadcrumbs, exception values
  test("walks an event and leaves the original untouched", () => {
    const event = {
      request: { url: `https://bg.test/photo-upload/${TOKEN}` },
      breadcrumbs: [
        { category: "navigation", data: { to: `/photo-upload/${TOKEN}` } },
      ],
      exception: { values: [{ value: `at /photo-upload/${TOKEN}` }] },
      level: "error",
    };
    const copy = JSON.parse(JSON.stringify(event));

    const out = redact(event);

    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.request.url).toBe("https://bg.test/photo-upload/[redacted]");
    expect(out.breadcrumbs[0]!.data.to).toBe("/photo-upload/[redacted]");
    expect(event).toEqual(copy);
  });

  test("returns a value with no token as the same object, and survives a cycle", () => {
    const clean: Record<string, unknown> = { url: "/campaigns/abc" };
    clean.self = clean;
    expect(redact(clean)).toBe(clean);
    const err = new Error("boom");
    expect(redact(err)).toBe(err);
  });
});
