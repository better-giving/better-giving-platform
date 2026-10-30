import { beforeEach, describe, expect, test, vi } from "vitest";

const auth_state = vi.hoisted(() => ({
  signed_in: true,
  sign_out: vi.fn(
    async () =>
      new Response(null, { headers: { "set-cookie": "session=; Max-Age=0" } })
  ),
}));
vi.mock("#/.server/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        auth_state.signed_in ? { user: { id: "u1" } } : null,
      signOut: auth_state.sign_out,
    },
  },
}));

import { action } from "./_app.logout";

const ORIGIN = "https://app.example";

const send = (url: URL, init: { content_type: string; body: string }) =>
  action({
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": init.content_type },
      body: init.body,
    }),
    context: {} as any,
    params: {},
  } as any) as Promise<Response>;

const logout = (
  redirect?: string,
  via: "form" | "query" = "form",
  query_redirect?: string
) => {
  const url = new URL("/logout", ORIGIN);
  const body = new URLSearchParams();
  if (redirect !== undefined) {
    if (via === "form") body.set("redirect", redirect);
    else url.searchParams.set("redirect", redirect);
  }
  if (query_redirect !== undefined) {
    url.searchParams.set("redirect", query_redirect);
  }
  return send(url, {
    content_type: "application/x-www-form-urlencoded",
    body: body.toString(),
  });
};

const location_of = (res: Response) =>
  new URL(res.headers.get("Location") ?? "", ORIGIN);

const CONSENT = "/admin/connector/allow?state=s.1&client=claude";

beforeEach(() => {
  auth_state.signed_in = true;
  auth_state.sign_out.mockClear();
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
      const location = location_of(res);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect")).toBe(CONSENT);
      expect(res.headers.get("set-cookie")).toContain("session=");
    }
  );

  const OFF_SITE = [
    "https://evil.com",
    "//evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
  ];

  test.each(
    (["form", "query"] as const).flatMap((via) =>
      OFF_SITE.map((raw) => [raw, via] as const)
    )
  )(
    "an off-site redirect %j in the %s is ignored, still signing out",
    async (raw, via) => {
      const res = await logout(raw, via);
      expect(res.headers.get("Location")).toBe("/marketplace");
      expect(res.headers.get("set-cookie")).toContain("session=");
    }
  );

  test("the form field wins over the query", async () => {
    const res = await logout(CONSENT, "form", "/donations");
    const location = location_of(res);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe(CONSENT);
  });

  test("a body that is not a form falls back to the query", async () => {
    const url = new URL("/logout", ORIGIN);
    url.searchParams.set("redirect", CONSENT);
    const res = await send(url, {
      content_type: "application/json",
      body: JSON.stringify({ redirect: "/donations" }),
    });
    const location = location_of(res);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe(CONSENT);
  });

  test("already signed out, a same-site redirect still goes to sign-in", async () => {
    auth_state.signed_in = false;
    const res = await logout(CONSENT);
    const location = location_of(res);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe(CONSENT);
    expect(auth_state.sign_out).not.toHaveBeenCalled();
  });

  test.each([
    ["no redirect", undefined],
    ["an off-site redirect", "//evil.com"],
  ])("already signed out with %s, lands on the marketplace", async (_, raw) => {
    auth_state.signed_in = false;
    const res = await logout(raw);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/marketplace");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(auth_state.sign_out).not.toHaveBeenCalled();
  });
});
