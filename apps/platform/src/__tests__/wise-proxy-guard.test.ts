import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

// --- mocks (hoisted) ---

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));

vi.mock("#/.server/auth", () => ({
  get_session: vi.fn(async () => ({ user: session.user })),
  user_ctx: Symbol("user_ctx"),
}));

vi.mock("$/env", () => ({
  app: { session_secret: "test-session-secret" },
  blob: { read_write_token: "blob-token" },
  blob_private: { read_write_token: "private-blob-token" },
  wise: {
    api_url: "https://wise.test",
    api_token: "wise-token",
    profile_id: "77",
  },
}));

vi.mock("$/pg/queries/user", () => ({ user_update: vi.fn(async () => {}) }));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ url: "https://blob.test/u/x" })),
}));

// --- imports (after mocks hoisted) ---

import { put } from "@vercel/blob";
import { sign_recipient } from "#/.server/wise-grant";
import { action as upload_action } from "#/routes/api.file-upload";
import {
  action as proxy_action,
  loader as proxy_loader,
} from "#/routes/api.wise.$";
import { action as payout_action } from "#/routes/dashboard.referrals_.payout/api";
import { user_update } from "$/pg/queries/user";

const USER = { id: "user-1", email: "one@example.com" };

// the proxy is a resource route: it hands back whatever `resp.fail`/`resp.json`
// built, so the status and body are read straight off the Response.
const upstream = vi.fn();

beforeEach(() => {
  session.user = { ...USER };
  upstream.mockReset();
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// the handlers take react-router's args object; a test supplies only the parts
// they read, so the shim is where the cast lives instead of every call site
const call_route = (
  fn: typeof proxy_action | typeof proxy_loader | typeof payout_action,
  a: {
    request: Request;
    url: URL;
    params?: Record<string, string>;
    context?: unknown;
  }
): Promise<Response> =>
  (fn as any)({ params: {}, context: {}, ...a }) as Promise<Response>;

const req = (method: string, body?: unknown) =>
  new Request("https://app.test/api/wise/v1/accounts", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("wise proxy", () => {
  it("refuses a caller with no session", async () => {
    session.user = null;
    const res = await call_route(proxy_action, {
      ...doc_args(req("POST", {})),
      params: { "*": "v1/accounts" },
    });

    expect(res.status).toBe(401);
    // nothing reached wise, so our api token never left the server
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a path the bank-details form never asks for", async () => {
    const res = await call_route(proxy_loader, {
      ...doc_args(new Request("https://app.test/api/wise/v1/profiles")),
      params: { "*": "v1/profiles" },
    });

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses an allowed path under the wrong method", async () => {
    // reading currencies is fine; writing to that path is not
    const res = await call_route(proxy_action, {
      ...doc_args(req("POST", {})),
      params: { "*": "v1/currencies" },
    });

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards an allowed call and stamps the created recipient", async () => {
    upstream.mockResolvedValue(
      new Response(JSON.stringify({ id: 4242, currency: "usd" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const res = await call_route(proxy_action, {
      ...doc_args(req("POST", { profile: "{{profileId}}" })),
      params: { "*": "v1/accounts" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(4242);
    expect(json.bg_grant).toBe(await sign_recipient(USER.id, 4242));

    // the profile placeholder is resolved server-side, so the browser never
    // needs to know the id
    // the quotes go with it — wise wants a number, not a string
    const [, init] = upstream.mock.calls[0];
    expect(init.body).toBe('{"profile":77}');
  });
});

describe("payout account", () => {
  const call = (body: unknown) =>
    call_route(payout_action, {
      ...doc_args(
        new Request("https://app.test/dashboard/referrals/payout", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        })
      ),
      context: { get: () => USER },
    });

  it("stores an id this user minted", async () => {
    const res = await call({
      id: 4242,
      grant: await sign_recipient(USER.id, 4242),
    });

    expect(res.status).toBe(302);
    expect(user_update).toHaveBeenCalledWith(USER.email, { pay_id: "4242" });
  });

  it("refuses an id with no grant", async () => {
    const res = await call({ id: 4242 });

    expect(res.status).toBe(403);
    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses an id another user minted", async () => {
    // the leak this guards: every recipient sits under one wise profile, so a
    // borrowed id would render someone else's account on the referrals page
    const res = await call({
      id: 4242,
      grant: await sign_recipient("user-2", 4242),
    });

    expect(res.status).toBe(403);
    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses a grant lifted onto a different id", async () => {
    const res = await call({
      id: 9999,
      grant: await sign_recipient(USER.id, 4242),
    });

    expect(res.status).toBe(403);
    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a recipient id", async () => {
    for (const id of ["not-a-number", -1, 0, 1.5]) {
      const res = await call({ id, grant: "x" });
      expect(res.status).toBe(400);
    }
    expect(user_update).not.toHaveBeenCalled();
  });
});

describe("file upload", () => {
  const upload = (filename: string) =>
    call_route(upload_action, {
      ...doc_args(
        new Request(
          `https://app.test/api/file-upload?kind=document&filename=${encodeURIComponent(filename)}`,
          // a real pdf, typed as an uploader posts it: a bare string goes as
          // text/plain, and the route checks the bytes against the type
          {
            method: "POST",
            body: new Blob(["%PDF-1.7\n"], { type: "application/pdf" }),
          }
        )
      ),
    });

  it("refuses a caller with no session", async () => {
    session.user = null;
    const res = await upload("statement.pdf");

    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  it("cannot address a client asset", async () => {
    // the build mirrors hashed js chunks into the same store under `assets/`;
    // overwriting one would run attacker js on every visitor
    await upload("../assets/index-AbC123.js");

    const [pathname, , opts] = vi.mocked(put).mock.calls[0];
    expect(pathname).toBe("docs/user-1/index-AbC123.js");
    expect(opts?.addRandomSuffix).toBe(true);
    expect(opts?.allowOverwrite).toBe(false);
  });

  it("keeps a plain name under the uploader's private folder", async () => {
    await upload("statement.pdf");

    const [pathname] = vi.mocked(put).mock.calls[0];
    expect(pathname).toBe("docs/user-1/statement.pdf");
    expect(vi.mocked(put).mock.calls[0]![2]).toMatchObject({
      access: "private",
    });
  });
});
