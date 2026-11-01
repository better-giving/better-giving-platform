import { describe, expect, it } from "vitest";
import { loader } from "./route";

const call = (request: Request, url: URL) =>
  loader({ params: { id: "7" }, request, url } as never) as Response;

describe("old profile url", () => {
  it("redirects to /org/<id>, keeping the query", () => {
    const href = "https://x/profile/7?referrer=R1";
    const res = call(new Request(href), new URL(href));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/org/7?referrer=R1");
  });

  it("redirects a data request to the same place as the document", () => {
    // a client navigation arrives raw: `.data` suffix and `_routes` left in
    const raw = new Request(
      "https://x/profile/7.data?referrer=R1&_routes=routes%2F_app.profile.%24id"
    );
    const res = call(raw, new URL("https://x/profile/7?referrer=R1"));
    expect(res.headers.get("location")).toBe("/org/7?referrer=R1");
  });
});
