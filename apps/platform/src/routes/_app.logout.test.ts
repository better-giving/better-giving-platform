import { beforeEach, describe, expect, test, vi } from "vitest";

const auth_state = vi.hoisted(() => ({ signed_in: true }));
vi.mock("#/.server/auth", async () => {
  const { to_auth } = await import("#/.server/auth/to-auth");
  return {
    to_auth,
    auth: {
      api: {
        getSession: async () =>
          auth_state.signed_in ? { user: { id: "u1" } } : null,
        signOut: async () =>
          new Response(null, {
            headers: { "set-cookie": "session=; Max-Age=0" },
          }),
      },
    },
  };
});

import { action } from "./_app.logout";

const ORIGIN = "https://app.example";

const logout = (redirect?: string, via: "form" | "query" = "form") => {
  const url = new URL("/logout", ORIGIN);
  const body = new URLSearchParams();
  if (redirect !== undefined) {
    if (via === "form") body.set("redirect", redirect);
    else url.searchParams.set("redirect", redirect);
  }
  return action({
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    context: {} as any,
    params: {},
  } as any) as Promise<Response>;
};

const CONSENT = "/admin/connector/allow?state=s.1&client=claude";

beforeEach(() => {
  auth_state.signed_in = true;
});

describe("logout", () => {
  test("with no redirect, signs out to the marketplace", async () => {
    const res = await logout();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/marketplace");
    expect(res.headers.get("set-cookie")).toContain("session=");
  });

  test.each(["form", "query"] as const)(
    "a same-site path in the %s signs out to sign-in, returning there",
    async (via) => {
      const res = await logout(CONSENT, via);
      const location = new URL(res.headers.get("Location") ?? "", ORIGIN);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect")).toBe(CONSENT);
      expect(res.headers.get("set-cookie")).toContain("session=");
    }
  );

  test.each([
    "https://evil.com",
    "//evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
  ])("an off-site redirect %j is ignored", async (raw) => {
    const res = await logout(raw);
    expect(res.headers.get("Location")).toBe("/marketplace");
  });

  test("already signed out, a same-site redirect still goes to sign-in", async () => {
    auth_state.signed_in = false;
    const res = await logout(CONSENT);
    const location = new URL(res.headers.get("Location") ?? "", ORIGIN);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe(CONSENT);
  });
});
