import { describe, expect, it } from "vitest";
import { loader } from "./api";

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as Response;
  }
  throw new Error("loader did not throw");
};

const call = (request: Request, url: URL) =>
  loader({ request, url, params: {} } as never);

describe("reset link that expired", () => {
  const q = "type=set-password&email=a%40b.co&token=t1&error=INVALID_TOKEN";

  it("sends the visitor to the expired step without the token", () => {
    const href = `https://x/login/reset?${q}`;
    const res = thrown(() => call(new Request(href), new URL(href)));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login/reset?type=expired&email=a%40b.co"
    );
  });

  it("redirects a data request to the same place as the document", () => {
    // a client navigation arrives raw: `.data` suffix and `_routes` left in
    const raw = new Request(
      `https://x/login/reset.data?${q}&_routes=routes%2F_app.login_.reset`
    );
    const res = thrown(() => call(raw, new URL(`https://x/login/reset?${q}`)));
    expect(res.headers.get("location")).toBe(
      "/login/reset?type=expired&email=a%40b.co"
    );
  });
});
