import { describe, expect, it } from "vitest";
import { to_auth } from "./to-auth";

describe("to_auth", () => {
  it("carries the referral id to signup and back to the arrival page", () => {
    const res = to_auth(
      new URL("https://bg.test/register/welcome?referrer=ABC123")
    );

    const to = new URL(res.headers.get("location") ?? "");
    expect(to.pathname).toBe("/signup");
    // the root loader stores the referral from the query it lands on
    expect(to.searchParams.get("referrer")).toBe("ABC123");
    // and the post-auth target still points at the referred registration
    expect(to.searchParams.get("redirect")).toBe(
      "/register/welcome?referrer=ABC123"
    );
  });
});
