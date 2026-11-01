import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- hoisted refs ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const test_auth_ref = vi.hoisted(() => ({ current: null as any }));
const send_email_or_throw = vi.hoisted(() =>
  vi.fn(async (_i: { node: any; to: string[]; subject: string }) => ({
    id: "email-1",
    response: "250 ok",
  }))
);
const enqueued = vi.hoisted(() => [] as { id: string; payload: any }[]);

// --- mocks ---

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

vi.mock("$/email", () => ({
  send_email_or_throw,
  // `handle_reg_updated` shares this module and keeps the swallowing send; the
  // factory has to name it or the module fails to load
  send_email: vi.fn(),
  sender: "test <test@test.com>",
}));

// the verified/unverified read is the whole subject here, so it runs against a
// real better-auth instance — only the one beneath it is swapped for pglite.
vi.mock("#/.server/auth/auth", () => ({
  auth: new Proxy(
    {},
    {
      get(_, prop) {
        if (!test_auth_ref.current) throw new Error("test auth not init");
        return (test_auth_ref.current as any)[prop];
      },
    }
  ),
}));

// the wizard case is driven through the real producer, so the flag's wiring is
// under test and not just the handler's branch. the queue is the seam between
// them — nothing else here needs qstash.
vi.mock("$/kit/queue", () => ({
  enqueue: vi.fn(async (...msgs: { id: string; payload: any }[]) => {
    enqueued.push(...msgs);
  }),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ session: true })
);

vi.mock("#/.server/cookie", () => ({
  reg_cookie: {
    parse: vi.fn(async () => ({})),
    serialize: vi.fn(async () => "bg-registration=x"),
  },
}));

// --- imports (after mocks) ---

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import { render } from "react-email";
import { createFormData } from "remix-hook-form";
import { get_session } from "#/.server/auth";
import {
  auth_options,
  LOGIN_LINK_TTL_S,
  login_link_plugin,
  RESUME_LINK_TTL_S,
} from "#/.server/auth/options";
import { create_unverified_user } from "#/.server/auth/unverified-user";
import { referral_id } from "#/helpers/referral";
import { new_application } from "#/pages/registration/new-application";
import * as schema from "$/pg/schema";
import {
  account,
  session,
  user as user_table,
  verification,
} from "$/pg/schema/auth";
import { registrations } from "$/pg/schema/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { handle_reg_created } from ".";

const BASE_URL = "http://localhost:4200";
const TEST_SECRET = "test-secret-at-least-32-characters-long!!";

beforeAll(async () => {
  test_db.current = await create_test_db();

  const deps = {
    referral_id,
    send_login_link: async () => {},
  };

  test_auth_ref.current = betterAuth({
    ...auth_options(deps),
    plugins: [login_link_plugin(deps)],
    secret: TEST_SECRET,
    baseURL: BASE_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(test_db.current.db, { provider: "pg", schema }),
  });
}, 30_000);

beforeEach(async () => {
  vi.clearAllMocks();
  enqueued.length = 0;
  const db = test_db.current!.db;
  await db.delete(verification);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user_table);
  await db.delete(registrations);
});

/** the html the applicant actually receives — the mail is the subject here, so
 * every assertion about it reads the rendered document rather than the props
 * the handler happened to pass. */
const sent_html = () => render(send_email_or_throw.mock.calls[0]![0].node);

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, "&")
  );

/** an application row at whatever step the given answers reach */
async function seed_reg(
  r_id: string,
  answers: Partial<typeof registrations.$inferInsert> = {}
) {
  const id = globalThis.crypto.randomUUID();
  await test_db.current!.db.insert(registrations).values({
    id,
    r_id,
    status: "01",
    ...answers,
  } as typeof registrations.$inferInsert);
  return id;
}

/** an address whose owner already proved it and holds a real account */
async function verified(email: string) {
  const created = await create_unverified_user({ email });
  await test_db
    .current!.db.update(user_table)
    .set({ emailVerified: true })
    .where(eq(user_table.email, email));
  return (created as any).user_id as string;
}

/** answers that carry a 501(c)(3) through contact and org details — `Progress`
 * reads that as banking, step 4 */
const mid_way = {
  r_first_name: "Ada",
  r_last_name: "Lovelace",
  o_name: "Analytical Engines",
  r_org_role: "ceo",
  rm: "other",
  o_website: "https://ae.org",
  o_hq_country: "US",
  o_designation: "charity",
  o_type: "501c3" as const,
  o_ein: "12-3456789",
};

const ttl_s = (at: Date) => (at.getTime() - Date.now()) / 1000;

const link_in_mail = (html: string, rid: string) =>
  hrefs(html).find((h) => h.includes(rid))!;

describe("handle_reg_created", () => {
  it("does not mail a verified account a registration it never started", async () => {
    await verified("owner@example.org");

    await handle_reg_created({
      id: "reg-1",
      r_id: "owner@example.org",
      unproven: true,
    });

    expect(send_email_or_throw).not.toHaveBeenCalled();
  });

  it("mails the registrant whose address is not yet proven", async () => {
    await create_unverified_user({ email: "lead@example.org" });

    await handle_reg_created({
      id: "reg-2",
      r_id: "lead@example.org",
      unproven: true,
    });

    expect(send_email_or_throw).toHaveBeenCalledOnce();
    expect(send_email_or_throw.mock.calls[0]![0]).toMatchObject({
      to: ["lead@example.org"],
    });
  });

  it("mails when the address has no account at all", async () => {
    await handle_reg_created({
      id: "reg-3",
      r_id: "nobody@example.org",
      unproven: true,
    });

    expect(send_email_or_throw).toHaveBeenCalledOnce();
  });

  it("gives the unproven applicant a way back in, not just a reference", async () => {
    await create_unverified_user({ email: "lead@example.org" });
    const rid = await seed_reg("lead@example.org");

    await handle_reg_created({
      id: rid,
      r_id: "lead@example.org",
      unproven: true,
    });

    const html = await sent_html();
    // the reference stays: it is the fallback for a client that strips links
    expect(html).toContain(rid);
    expect(hrefs(html).some((h) => h.includes(rid))).toBe(true);
  });

  it("lands the applicant on the step they left, not back at the start", async () => {
    await create_unverified_user({ email: "lead@example.org" });
    // contact + org details answered, and a 501(c)(3) identity — which crosses
    // the agreement step, so `Progress` puts them on banking
    const rid = await seed_reg("lead@example.org", mid_way);

    await handle_reg_created({
      id: rid,
      r_id: "lead@example.org",
      unproven: true,
    });

    // followed exactly as the mail client would: the token this handler minted
    // has to be one better-auth's own verify endpoint accepts
    const res: Response = await test_auth_ref.current.handler(
      new Request(link_in_mail(await sent_html(), rid), {
        headers: { origin: BASE_URL },
      })
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE_URL}/register/${rid}/4`);
  });

  it("signs in the applicant whose address was never proven", async () => {
    await create_unverified_user({ email: "lead@example.org" });
    const rid = await seed_reg("lead@example.org", mid_way);

    await handle_reg_created({
      id: rid,
      r_id: "lead@example.org",
      unproven: true,
    });

    // redeemed without a callback, so the endpoint answers with the session it
    // made rather than a redirect — the set-cookie a browser would read is
    // stripped from `Headers` in this environment, and this asserts the same
    // thing without it
    const token = new URL(
      link_in_mail(await sent_html(), rid)
    ).searchParams.get("token")!;
    const out = await test_auth_ref.current.api.magicLinkVerify({
      query: { token },
      headers: new Headers({ origin: BASE_URL }),
    });

    expect(out.user.email).toBe("lead@example.org");
    // following the link is the proof of the address, same as any sign-in link
    expect(out.user.emailVerified).toBe(true);
    expect(out.session.userId).toBe(out.user.id);
  });

  it("mails the proven applicant a plain link, never a key to their account", async () => {
    await verified("founder@example.org");
    const rid = await seed_reg("founder@example.org", mid_way);

    await handle_reg_created({
      id: rid,
      r_id: "founder@example.org",
      unproven: false,
    });

    // they already hold a session; the link is a destination, and following it
    // can only land them on the step or bounce them through the ordinary gate
    expect(link_in_mail(await sent_html(), rid)).toBe(
      `${BASE_URL}/register/${rid}/4`
    );
    // and nothing redeemable was left sitting in a proven account's inbox
    expect(await test_db.current!.db.select().from(verification)).toHaveLength(
      0
    );
  });

  it("outlives a login link without lengthening one", async () => {
    await create_unverified_user({ email: "lead@example.org" });
    const rid = await seed_reg("lead@example.org");
    await handle_reg_created({
      id: rid,
      r_id: "lead@example.org",
      unproven: true,
    });

    const [minted] = await test_db.current!.db.select().from(verification);
    expect(ttl_s(minted!.expiresAt)).toBeGreaterThan(LOGIN_LINK_TTL_S);
    expect(ttl_s(minted!.expiresAt)).toBeGreaterThan(RESUME_LINK_TTL_S - 60);

    // the sign-in form mints through the plugin, which still answers to its own
    // `expiresIn` — the welcome link's lifetime is not a global one
    await test_db.current!.db.delete(verification);
    await test_auth_ref.current.api.signInMagicLink({
      body: { email: "lead@example.org" },
      headers: new Headers(),
    });
    const [login] = await test_db.current!.db.select().from(verification);
    expect(ttl_s(login!.expiresAt)).toBeLessThanOrEqual(LOGIN_LINK_TTL_S);
    expect(ttl_s(login!.expiresAt)).toBeGreaterThan(LOGIN_LINK_TTL_S - 60);
  });

  it("mails the verified applicant who started it from the wizard", async () => {
    // the reference id in this mail is what `resume_application` takes, and
    // every wizard applicant is signed in — so verified.
    await verified("founder@example.org");
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u1", email: "founder@example.org", emailVerified: true },
    } as any);

    const res = await new_application(
      new Request("https://bg.test/register", { method: "POST" }),
      new URL("https://bg.test/register"),
      createFormData({ o_type: "501c3", o_ein: "12-3456789" })
    );
    expect((res as Response).headers.get("location")).toMatch(/^\/register\//);

    const m = enqueued.find((x) => x.id === "reg-created");
    expect(m?.payload.unproven).toBe(false);

    await handle_reg_created(m!.payload);

    expect(send_email_or_throw).toHaveBeenCalledOnce();
    expect(send_email_or_throw.mock.calls[0]![0]).toMatchObject({
      to: ["founder@example.org"],
    });
  });
});
