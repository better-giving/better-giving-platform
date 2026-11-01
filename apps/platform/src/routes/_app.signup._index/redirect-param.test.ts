import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const session = vi.hoisted(() => ({ user: undefined as object | undefined }));
const sign_in_social = vi.hoisted(() => vi.fn());

vi.mock("#/.server/auth", () => ({
  auth: { api: { signInSocial: sign_in_social } },
  create_unverified_user: vi.fn(),
  get_session: vi.fn(async () => session),
}));
vi.mock("#/.server/auth/login-link", () => ({
  check_email_url: vi.fn(),
  request_login_link: vi.fn(),
}));
vi.mock("#/errors/report", () => ({ report_undefined: vi.fn() }));
vi.mock("./evaluate", () => ({ evaluate: vi.fn() }));

import { action } from "./api";

const EVIL = "https://evil.example/relogin";

const post = (redirect: string, body = new FormData()) =>
  new Request(
    `https://app.test/signup?redirect=${encodeURIComponent(redirect)}`,
    { method: "POST", body }
  );

const oauth = () => {
  const body = new FormData();
  body.set("intent", "oauth");
  return body;
};

beforeEach(() => {
  session.user = undefined;
  sign_in_social.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("/signup ?redirect=", () => {
  it("sends a signed-in submitter home, not off-site", async () => {
    session.user = { id: "u1" };
    const res = (await action({ ...doc_args(post(EVIL)) } as any)) as Response;
    expect(res.headers.get("location")).toBe("/marketplace");
  });

  it("never gives google an off-site callback", async () => {
    await action({ ...doc_args(post(EVIL, oauth())) } as any);
    expect(sign_in_social.mock.calls[0][0].body.callbackURL).toBe(
      "/marketplace"
    );
  });

  it("gives google a same-origin callback as asked", async () => {
    await action({ ...doc_args(post("/dashboard", oauth())) } as any);
    expect(sign_in_social.mock.calls[0][0].body.callbackURL).toBe("/dashboard");
  });

  it("sends a failed google sign-in to /login, keeping the return path", async () => {
    await action({ ...doc_args(post("/donate/x?a=1&b=2", oauth())) } as any);
    const to = new URL(
      sign_in_social.mock.calls[0][0].body.errorCallbackURL,
      "https://app.test"
    );
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("redirect")).toBe("/donate/x?a=1&b=2");
  });
});
