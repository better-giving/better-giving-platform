import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session = vi.hoisted(() => ({ user: undefined as object | undefined }));
const sign_in_social = vi.hoisted(() => vi.fn());
const sign_in_email = vi.hoisted(() => vi.fn());
type LoginLink = typeof import("#/.server/auth/login-link");
const login_link = vi.hoisted(() => ({
  check_email_url: vi.fn<LoginLink["check_email_url"]>(() => "/check-email"),
  request_login_link: vi.fn<LoginLink["request_login_link"]>(),
}));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));
vi.mock("#/.server/auth", () => ({
  auth: {
    api: { signInSocial: sign_in_social, signInEmail: sign_in_email },
  },
  get_session: vi.fn(async () => session),
  request_password_reset: vi.fn(),
}));
vi.mock("#/.server/auth/login-link", () => login_link);
vi.mock("#/.server/toast", () => ({ dataWithError: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

import { account, user as user_table } from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./route";

const EVIL = "https://evil.example/relogin";
const EMAIL = "someone@example.com";

const req = (redirect: string, init?: RequestInit) =>
  new Request(
    `https://app.test/login?redirect=${encodeURIComponent(redirect)}`,
    init
  );

const location_of = (res: unknown) => (res as Response).headers.get("location");

/** a password submit that better-auth refuses with `code` */
const refused_sign_in = (redirect: string, code: string) => {
  sign_in_email.mockResolvedValue(
    Response.json({ code, message: "refused" }, { status: 401 })
  );
  const body = new FormData();
  body.set("email", EMAIL);
  body.set("password", "any-password-1");
  return action({
    ...doc_args(req(redirect, { method: "POST", body })),
  } as any);
};

beforeAll(async () => {
  test_db.current = await create_test_db();
});

beforeEach(async () => {
  session.user = undefined;
  const db = test_db.current!.db;
  await db.delete(user_npo_memberships);
  await db.delete(npos);
  await db.delete(account);
  await db.delete(user_table);
});

async function seed_user(opts: { role?: string; orgs?: number } = {}) {
  const id = crypto.randomUUID();
  await test_db.current!.db.insert(user_table).values({
    id,
    name: "",
    email: EMAIL,
    emailVerified: true,
    role: opts.role ?? "user",
    first_name: "",
    last_name: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const org_ids: number[] = [];
  for (let i = 0; i < (opts.orgs ?? 0); i++) {
    const [org] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: `EIN-LOGIN-${i}-${id.slice(0, 8)}`,
        name: `Org ${i}`,
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    org_ids.push(org!.id);
    await test_db.current!.db.insert(user_npo_memberships).values({
      user_id: id,
      npo_id: org!.id,
    });
  }
  return { id, org_ids };
}

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

describe("/login ?redirect=", () => {
  it("sends a signed-in visitor home, not off-site", async () => {
    session.user = { id: "u1" };
    const res = await loader({ ...doc_args(req(EVIL)) } as any);
    expect(location_of(res)).toBe("/marketplace");
  });

  it("sends a signed-in visitor home rather than failing on an unsendable path", async () => {
    session.user = { id: "u1" };
    const res = await loader({ ...doc_args(req("/ ")) } as any);
    expect(location_of(res)).toBe("/marketplace");
  });

  it("hands the page a safe return path to forward to signup and reset", async () => {
    expect(await loader({ ...doc_args(req("//evil.example")) } as any)).toBe(
      "/marketplace"
    );
    expect(await loader({ ...doc_args(req("/dashboard")) } as any)).toBe(
      "/dashboard"
    );
  });

  it("forwards the same default a sign-in lands on when none is asked", async () => {
    const res = await loader({
      ...doc_args(new Request("https://app.test/login")),
    } as any);
    expect(res).toBe("/marketplace");
  });

  it("sends a signed-in submitter home, not off-site", async () => {
    session.user = { id: "u1" };
    const res = await action({
      ...doc_args(req(EVIL, { method: "POST", body: new FormData() })),
    } as any);
    expect(location_of(res)).toBe("/marketplace");
  });

  it("sends a signed-in submitter home past a double-encoded authority", async () => {
    session.user = { id: "u1" };
    const res = await action({
      ...doc_args(
        req("/%2F%2Fevil.example", {
          method: "POST",
          body: new FormData(),
        })
      ),
    } as any);
    expect(location_of(res)).toBe("/marketplace");
  });

  it("never gives google an off-site callback", async () => {
    sign_in_social.mockResolvedValue(new Response(null, { status: 200 }));
    const body = new FormData();
    body.set("intent", "oauth");
    await action({ ...doc_args(req(EVIL, { method: "POST", body })) } as any);
    expect(sign_in_social.mock.calls[0][0].body.callbackURL).toBe("/login");
    expect(sign_in_social.mock.calls[0][0].body.errorCallbackURL).toBe(
      "/login"
    );
  });

  it("gives google a same-origin callback as asked", async () => {
    sign_in_social.mockResolvedValue(new Response(null, { status: 200 }));
    const body = new FormData();
    body.set("intent", "oauth");
    await action({
      ...doc_args(req("/dashboard", { method: "POST", body })),
    } as any);
    expect(sign_in_social.mock.calls[0][0].body.callbackURL).toBe("/dashboard");
  });

  it("sends a failed google sign-in back here, keeping the return path", async () => {
    sign_in_social.mockResolvedValue(new Response(null, { status: 200 }));
    const body = new FormData();
    body.set("intent", "oauth");
    await action({
      ...doc_args(req("/donate/x?a=1&b=2", { method: "POST", body })),
    } as any);
    const to = new URL(
      sign_in_social.mock.calls[0][0].body.errorCallbackURL,
      "https://app.test"
    );
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("redirect")).toBe("/donate/x?a=1&b=2");
  });

  it.each([
    [EVIL, "/login"],
    ["/dashboard", "/dashboard"],
  ])(
    "mails an unverified address a link back to %s as %s",
    async (asked, to) => {
      await refused_sign_in(asked, "EMAIL_NOT_VERIFIED");
      expect(login_link.request_login_link.mock.calls[0][0].redirect_to).toBe(
        to
      );
      expect(login_link.check_email_url.mock.calls[0][0].redirect_to).toBe(to);
    }
  );

  it.each([
    [EVIL, null],
    ["/dashboard", "/dashboard"],
  ])(
    "forwards %s to a migrated user's reset screen as %s",
    async (asked, to) => {
      // a proven address with no credential: what the cognito migration left
      await test_db.current!.db.insert(user_table).values({
        id: crypto.randomUUID(),
        name: "",
        email: EMAIL,
        emailVerified: true,
        first_name: "",
        last_name: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const res = await refused_sign_in(asked, "INVALID_EMAIL_OR_PASSWORD");
      const reset = new URL(location_of(res)!);
      expect(reset.searchParams.get("type")).toBe("migrated");
      expect(reset.searchParams.get("redirect")).toBe(to);
    }
  );
});

describe("/login home", () => {
  it("sends a single-org member to that dashboard after a password sign-in", async () => {
    const { org_ids } = await seed_user({ orgs: 1 });
    const res = await password_sign_in();
    expect(location_of(res)).toBe(`/admin/${org_ids[0]}/dashboard`);
    expect((res as Response).headers.get("set-cookie")).toBe("bg=1");
  });

  it("keeps a platform admin on the marketplace", async () => {
    await seed_user({ role: "admin", orgs: 1 });
    const res = await password_sign_in();
    expect(location_of(res)).toBe("/marketplace");
  });

  it("keeps zero and several memberships on the marketplace", async () => {
    await seed_user({ orgs: 0 });
    expect(location_of(await password_sign_in())).toBe("/marketplace");
    await test_db.current!.db.delete(user_npo_memberships);
    await test_db.current!.db.delete(npos);
    await test_db.current!.db.delete(user_table);
    await seed_user({ orgs: 2 });
    expect(location_of(await password_sign_in())).toBe("/marketplace");
  });

  it("still honors an explicit redirect after a password sign-in", async () => {
    await seed_user({ orgs: 1 });
    const res = await password_sign_in("/dashboard");
    expect(location_of(res)).toBe("/dashboard");
  });

  it("sends an already signed-in single-org member to that dashboard", async () => {
    const { id, org_ids } = await seed_user({ orgs: 1 });
    session.user = { id, role: "user" };
    const res = await loader({
      ...doc_args(new Request("https://app.test/login")),
    } as any);
    expect(location_of(res)).toBe(`/admin/${org_ids[0]}/dashboard`);
  });

  it("keeps an explicit redirect ahead of the single-org dashboard", async () => {
    const { id } = await seed_user({ orgs: 1 });
    session.user = { id, role: "user" };
    const res = await loader({ ...doc_args(req("/donate/x")) } as any);
    expect(location_of(res)).toBe("/donate/x");
  });

  it("keeps a signed-in platform admin on the marketplace", async () => {
    const { id } = await seed_user({ role: "admin", orgs: 1 });
    session.user = { id, role: "admin" };
    const res = await loader({
      ...doc_args(new Request("https://app.test/login")),
    } as any);
    expect(location_of(res)).toBe("/marketplace");
  });
});
