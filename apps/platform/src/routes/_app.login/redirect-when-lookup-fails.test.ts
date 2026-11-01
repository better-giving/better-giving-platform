import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const sign_in_email = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("user lookup down");
  })
);
const user_npos = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("membership lookup down");
  })
);

vi.mock("$/pg/db", () => ({
  db: { select },
}));
vi.mock("$/pg/queries/user", () => ({ user_npos }));
vi.mock("#/.server/auth", () => ({
  auth: { api: { signInEmail: sign_in_email } },
  get_session: vi.fn(async () => ({ user: undefined })),
  request_password_reset: vi.fn(),
}));
vi.mock("#/.server/auth/login-link", () => ({
  check_email_url: vi.fn(),
  request_login_link: vi.fn(),
}));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

import { action } from "./route";

const EMAIL = "someone@example.com";

const password_sign_in = (redirect?: string) => {
  sign_in_email.mockResolvedValue(
    new Response(null, {
      status: 200,
      headers: { "set-cookie": "bg=1" },
    })
  );
  const body = new FormData();
  body.set("email", EMAIL);
  body.set("password", "any-password-1");
  const url = redirect
    ? `https://app.test/login?redirect=${encodeURIComponent(redirect)}`
    : "https://app.test/login";
  return action({
    ...doc_args(new Request(url, { method: "POST", body })),
  } as any);
};

beforeEach(() => {
  select.mockClear();
  user_npos.mockClear();
});

describe("password sign-in when the user lookup throws", () => {
  it("redirects to the asked path and forwards the session cookie", async () => {
    const res = await password_sign_in("/dashboard");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("location")).toBe("/dashboard");
    expect((res as Response).headers.get("set-cookie")).toBe("bg=1");
    expect(select).not.toHaveBeenCalled();
    expect(user_npos).not.toHaveBeenCalled();
  });

  it("returns the error response when no path was asked", async () => {
    const res = await password_sign_in();
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ data: null, init: { status: 500 } });
    expect(select).toHaveBeenCalled();
  });
});
