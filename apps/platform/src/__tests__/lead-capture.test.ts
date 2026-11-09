import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { registrations } from "$/pg/schema/registration";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- hoisted refs ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const test_auth_ref = vi.hoisted(() => ({ current: null as any }));
const mock_send_email = vi.hoisted(() => vi.fn());
/** every login/verification link the auth config mails out */
const sent_links = vi.hoisted(() => [] as { email: string; url: string }[]);
const issued = vi.hoisted(() => [] as string[]);
const mock_evaluate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    is_spam: false,
    spam_score: 0,
    explanation: "ok",
    field: "email",
  })
);

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
  send_email: mock_send_email,
  sender: "test <test@test.com>",
}));

vi.mock("$/env", () => ({
  app: { session_secret: "test-secret-at-least-32-characters-long!!" },
  base_url: "http://localhost:4200",
  stripe: { connect_routing: true },
}));

// the auth surface under test is real — only the better-auth instance beneath
// it is swapped for the pglite-backed one built below.
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

/* every draft grant the flow mints, captured on the way out. a browser's
 * `Headers` carries the "response" guard, which silently drops `set-cookie`
 * from a constructed `Response` — the cookie is unreadable off the redirect
 * here, though not on a real node server. so the value is taken at the source
 * and replayed onto the requests below, which is what it is for. */
vi.mock("#/.server/auth/draft-grant", async (orig) => {
  const actual = (await orig()) as typeof import("#/.server/auth/draft-grant");
  return {
    ...actual,
    issue_draft_grant: vi.fn(async (user_id: string) => {
      const cookie = await actual.issue_draft_grant(user_id);
      issued.push(cookie);
      return cookie;
    }),
  };
});

vi.mock("#/pages/registration/new-application", async (orig) => {
  const actual =
    (await orig()) as typeof import("#/pages/registration/new-application");
  return {
    ...actual,
    new_application_for: vi.fn(actual.new_application_for),
  };
});

vi.mock("$/kit/queue", () => ({
  receiver: {},
  client: {},
  enqueue: vi.fn(),
  don_dist: vi.fn(),
  verify_qstash: vi.fn(),
}));

vi.mock("#/.server/cookie", () => ({
  reg_cookie: {
    parse: vi.fn(async () => ({})),
    serialize: vi.fn(async () => "bg-registration=x"),
  },
}));

// the lead path calls the organization prompt; the person one is mocked too so
// the module stays whole for anything else in the graph that reaches for it
vi.mock("#/routes/_app.signup._index/evaluate", () => ({
  evaluate: mock_evaluate,
  evaluate_org: mock_evaluate,
}));

vi.mock("emails", () => ({
  login_link: { template: () => ({ node: null, subject: "Sign in" }) },
  reset_password: { template: () => ({ node: null, subject: "Reset" }) },
}));

// --- imports (after mocks) ---

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import { auth_options, login_link_plugin } from "#/.server/auth/options";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { reg_cookie } from "#/.server/cookie";
import { seed_password_user } from "#/__tests__/fixtures/password-user";
import { referral_id } from "#/helpers/referral";
import { reg_loader, step_loader } from "#/pages/registration/data/step-loader";
import {
  LEAD_PER_IP,
  LEAD_PER_USER,
} from "#/pages/registration/lead-application";
import { new_application_for } from "#/pages/registration/new-application";
import { resume_application } from "#/pages/registration/resume-application";
import { next_step } from "#/pages/registration/routes";
import { update_action } from "#/pages/registration/update-action";
import { loader as reg_layout_loader } from "#/routes/_app.register/api";
import { loader as reg_index_loader } from "#/routes/_app.register._index/api";
import { action as intl_action } from "#/routes/_landing.for-international-nonprofits/api";
import { action as us_action } from "#/routes/_landing.for-nonprofits/api";
import { reg_put } from "$/pg/queries/registration";
import * as schema from "$/pg/schema";
import {
  account,
  session,
  user,
  user as user_table,
  verification,
} from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";

const BASE_URL = "http://localhost:4200";
const TEST_SECRET = "test-secret-at-least-32-characters-long!!";
const LEAD_EMAIL = "lead@example.org";
const LEAD_THROTTLED =
  "Too many submissions. Please try again in a few minutes.";

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();

  const deps = {
    referral_id,
    send_login_link: async (a: { email: string; url: string }) => {
      sent_links.push(a);
      mock_send_email({ type: "link", ...a });
    },
  };

  test_auth_ref.current = betterAuth({
    ...auth_options(deps),
    plugins: [login_link_plugin(deps)],
    secret: TEST_SECRET,
    baseURL: BASE_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(test_db.current.db, { provider: "pg", schema }),
  });
  await test_auth_ref.current.$context;
}, 30_000);

beforeEach(async () => {
  const db = test_db.current!.db;
  await db.delete(registrations);
  await db.delete(user_npo_memberships);
  await db.delete(npos);
  await db.delete(verification);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user_table);
  mock_send_email.mockClear();
  sent_links.length = 0;
  issued.length = 0;
  mock_evaluate.mockClear();
  mock_evaluate.mockResolvedValue({
    is_spam: false,
    spam_score: 0,
    explanation: "ok",
    field: "email",
  });
  // the throttle counters are module-global and outlive a request by design
  reset_rate_limits();
});

// --- helpers ---

const US_LEAD = {
  o_type: "501c3",
  o_name: "Riverside Youth Alliance",
  o_ein: "12-3456789",
  email: LEAD_EMAIL,
};

const INTL_LEAD = {
  o_type: "other",
  o_name: "Global Aid Kenya",
  o_hq_country: "Kenya",
  o_registration_number: "KE-99",
  email: LEAD_EMAIL,
};

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** a real POST the way the marketing page's own `<Form method="post">` makes it */
function post(
  fields: Record<string, string>,
  url = "https://bg.test/for-nonprofits"
) {
  return new Request(url, { method: "POST", body: form(fields) });
}

/** the same POST, carrying a session cookie. `req` below replaces the whole
 * header set, so the multipart boundary has to be carried over by hand or
 * `request.formData()` has nothing to parse the body against. */
function post_as(
  cookie: string,
  fields: Record<string, string>,
  url = "https://bg.test/for-nonprofits"
) {
  const r = new Request(url, { method: "POST", body: form(fields) });
  const headers = new Headers();
  const ct = r.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("cookie", cookie);
  Object.defineProperty(r, "headers", { value: headers });
  return r;
}

/** the same POST, arriving from a named source. the submission gate reads the
 * forwarding header and falls open without one, which is why every other helper
 * here is untouched by it. */
function post_from(
  ip: string,
  fields: Record<string, string>,
  url = "https://bg.test/for-nonprofits"
) {
  const r = new Request(url, { method: "POST", body: form(fields) });
  const headers = new Headers();
  const ct = r.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("x-forwarded-for", ip);
  Object.defineProperty(r, "headers", { value: headers });
  return r;
}

/** a signed-in POST arriving from a named source — both keys the gate could
 * choose between are present, so a test that pins which one it used means it. */
function post_as_from(
  cookie: string,
  ip: string,
  fields: Record<string, string>
) {
  const r = post_as(cookie, fields);
  r.headers.set("x-forwarded-for", ip);
  return r;
}

/** a verified account already owning the address */
async function verified_account(email: string) {
  await seed_password_user(test_auth_ref.current, {
    email,
    password: "Test1234!@",
    name: "Real Owner",
    first_name: "Real",
    last_name: "Owner",
  });
  await test_db
    .current!.db.update(user_table)
    .set({ emailVerified: true })
    .where(eq(user_table.email, email));
}

/** what the check-email screen was told to say. two submissions that produce
 * the same triple told the caller the same thing. */
function check_email(res: Response) {
  const to = new URL(res.headers.get("location")!, BASE_URL);
  return {
    pathname: to.pathname,
    email: to.searchParams.get("email"),
    redirect: to.searchParams.get("redirect"),
  };
}

/** vitest runs in a real browser, where `Cookie` is a forbidden header on
 * `Request` and is silently dropped. shadowing the instance getter puts it
 * back; every gate below only ever reads `request.headers`. */
function req(url: string, cookie?: string, init?: RequestInit) {
  const r = new Request(url, init);
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  Object.defineProperty(r, "headers", { value: headers });
  return r;
}

/** the grant the last lead submission minted, as a Cookie header would carry it */
const grant = () => issued.at(-1)!.split(";")[0]!;

/** a real signed-in session, cookie included. `returnHeaders` hands back a
 * bare `Headers` — a `Response`'s would have its `set-cookie` stripped here. */
async function sign_in(email: string, password = "Test1234!@") {
  await seed_password_user(test_auth_ref.current, {
    email,
    password,
    name: email,
    first_name: "A",
    last_name: "B",
  });
  await test_db
    .current!.db.update(user_table)
    .set({ emailVerified: true })
    .where(eq(user_table.email, email));

  const { headers } = await test_auth_ref.current.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return headers
    .getSetCookie()
    .map((c: string) => c.split(";")[0])
    .join("; ");
}

/** a listing with a member behind it — the only kind that blocks a new
 * application (see `npo_owned_by_regnum`) */
async function seed_owned_npo(registration_number: string, name: string) {
  const [npo] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: false,
      active: true,
    })
    .returning();
  await test_db
    .current!.db.insert(user)
    .values({
      id: `member-${npo!.id}`,
      name: "Member",
      email: `member-${npo!.id}@example.com`,
      first_name: "Mem",
      last_name: "Ber",
    })
    .onConflictDoNothing();
  await test_db
    .current!.db.insert(user_npo_memberships)
    .values({ user_id: `member-${npo!.id}`, npo_id: npo!.id })
    .onConflictDoNothing();
}

async function all_users() {
  return test_db.current!.db.select().from(user_table);
}

async function all_regs() {
  return test_db.current!.db.select().from(registrations);
}

// --- tests ---

describe("marketing lead → application", () => {
  it("creates one unverified user and one application, and hands over the wizard", async () => {
    const res: any = await us_action({ ...doc_args(post(US_LEAD)) } as any);

    const users = await all_users();
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe(LEAD_EMAIL);
    expect(users[0]!.emailVerified).toBe(false);

    const regs = await all_regs();
    expect(regs).toHaveLength(1);
    expect(regs[0]!.r_id).toBe(LEAD_EMAIL);
    expect(regs[0]!.o_type).toBe("501c3");
    expect(regs[0]!.o_ein).toBe("123456789");
    // the contact step prefills from the row — the lead already typed this
    expect(regs[0]!.o_name).toBe("Riverside Youth Alliance");

    expect(res.headers.get("location")).toBe(`/register/${regs[0]!.id}/1`);
    // the grant is what gets them through the contact step before the address
    // is proven
    expect(issued).toHaveLength(1);
    expect(issued[0]).toContain("bg-draft=");
  }, 30_000);

  it("refuses an anonymous source that has spent its submissions", async () => {
    // distinct identity and address each time, so nothing but the ip ceiling
    // can be what stops the last one
    for (let i = 0; i < LEAD_PER_IP.max; i++) {
      const res: any = await us_action({
        ...doc_args(
          post_from("203.0.113.30", {
            ...US_LEAD,
            o_ein: `12-${3456789 + i}`,
            email: `lead${i}@example.org`,
          })
        ),
      } as any);
      expect(res.status).toBe(302);
    }

    mock_evaluate.mockClear();
    const over = us_action({
      ...doc_args(
        post_from("203.0.113.30", {
          ...US_LEAD,
          o_ein: "98-7654321",
          email: "over@example.org",
        })
      ),
    } as any);

    // visible on the form, values kept — it fires on volume, never on anything
    // about the address, so it tells a prober nothing it did not already know
    const res: any = await over;
    expect(res.init.status).toBe(400);
    expect(res.data.message).toBe(LEAD_THROTTLED);
    expect(res.data.errors).toEqual({});
    expect(res.data.values).toMatchObject({
      o_ein: "98-7654321",
      email: "over@example.org",
    });
    // and it refuses before spending any of what it exists to protect
    expect(mock_evaluate).not.toHaveBeenCalled();
    expect(await all_regs()).toHaveLength(LEAD_PER_IP.max);
    expect(await all_users()).toHaveLength(LEAD_PER_IP.max);
  }, 60_000);

  it("throttles a signed-in applicant on their own account", async () => {
    // a session is not an exemption — it only changes which key is counted.
    // unbounded here would be unbounded spam calls and notifications for the
    // price of one verified account.
    const cookie = await sign_in("staff@example.org");
    for (let i = 0; i < LEAD_PER_USER.max; i++) {
      const res: any = await us_action({
        ...doc_args(
          post_as_from(cookie, "203.0.113.31", {
            ...US_LEAD,
            o_ein: `12-${3456789 + i}`,
            email: "staff@example.org",
          })
        ),
      } as any);
      expect(res.status).toBe(302);
    }

    mock_evaluate.mockClear();
    const over = us_action({
      ...doc_args(
        post_as_from(cookie, "203.0.113.31", {
          ...US_LEAD,
          o_ein: "98-7654321",
          email: "staff@example.org",
        })
      ),
    } as any);

    const res: any = await over;
    expect(res.init.status).toBe(400);
    expect(res.data.message).toBe(LEAD_THROTTLED);
    expect(mock_evaluate).not.toHaveBeenCalled();
    expect(await all_regs()).toHaveLength(LEAD_PER_USER.max);
  }, 60_000);

  it("does not let a spent source block signed-in applicants sharing it", async () => {
    // the whole point of keying a session by account: an office or a carrier
    // NAT can burn the anonymous ceiling for that address without any of the
    // people behind it inheriting the refusal.
    const ip = "203.0.113.40";
    for (let i = 0; i < LEAD_PER_IP.max; i++) {
      const res: any = await us_action({
        ...doc_args(
          post_from(ip, {
            ...US_LEAD,
            o_ein: `12-${3456789 + i}`,
            email: `lead${i}@example.org`,
          })
        ),
      } as any);
      expect(res.status).toBe(302);
    }

    // spent, for anyone anonymous behind it
    const anon = us_action({
      ...doc_args(
        post_from(ip, {
          ...US_LEAD,
          o_ein: "98-7654321",
          email: "anon@example.org",
        })
      ),
    } as any);
    expect(((await anon) as any).data.message).toBe(LEAD_THROTTLED);

    // two colleagues in that same building, each signed in: neither inherits it
    const pairs = [
      [await sign_in("a@example.org"), "a@example.org", "11-2223334"],
      [await sign_in("b@example.org"), "b@example.org", "44-5556667"],
    ] as const;
    for (const [cookie, email, o_ein] of pairs) {
      const res: any = await us_action({
        ...doc_args(post_as_from(cookie, ip, { ...US_LEAD, o_ein, email })),
      } as any);
      expect(res.status).toBe(302);
    }
  }, 60_000);

  it("fails loudly when starting the application answers with nowhere to go, creating no account", async () => {
    const odd = new Response(null, { status: 200 });
    vi.mocked(new_application_for).mockResolvedValueOnce(odd);

    await expect(us_action({ ...doc_args(post(US_LEAD)) } as any)).rejects.toBe(
      odd
    );

    expect(await all_users()).toHaveLength(0);
    expect(issued).toHaveLength(0);
  }, 30_000);

  it("faults an EIN that is not nine digits and creates nothing", async () => {
    const res: any = await us_action({
      ...doc_args(post({ ...US_LEAD, o_ein: "12345" })),
    } as any);

    expect(res.init.status).toBe(400);
    expect(res.data.errors.o_ein).toContain("9-digit EIN");
    expect(await all_users()).toHaveLength(0);
    expect(await all_regs()).toHaveLength(0);
  }, 30_000);

  it("hands back every posted value so a failed submit keeps the form", async () => {
    const res: any = await us_action({
      ...doc_args(post({ ...US_LEAD, o_ein: "12345" })),
    } as any);

    // keyed by the names the form posts, so the fields repopulate as typed
    expect(res.data.values).toEqual({
      o_name: "Riverside Youth Alliance",
      o_ein: "12345",
      o_hq_country: "",
      o_registration_number: "",
      email: LEAD_EMAIL,
    });
  }, 30_000);

  it("creates nothing for a post carrying no org type", async () => {
    const { o_type: _, ...without } = US_LEAD;

    const res = us_action({ ...doc_args(post(without)) } as any);

    // `o_type` is a hidden input no one can edit — a fault on it is malformed,
    // not correctable, and must not reach a write
    await expect(res).rejects.toMatchObject({ status: 400 });
    expect(await all_users()).toHaveLength(0);
    expect(await all_regs()).toHaveLength(0);
  }, 30_000);

  it("creates nothing when the honeypot is filled", async () => {
    const res = us_action({
      ...doc_args(post({ ...US_LEAD, middle_name: "i am a bot" })),
    } as any);

    await expect(res).rejects.toMatchObject({ status: 400 });
    expect(await all_users()).toHaveLength(0);
    expect(await all_regs()).toHaveLength(0);
    // the screen never ran, so nothing was spent on it either
    expect(mock_evaluate).not.toHaveBeenCalled();
  }, 30_000);

  it("faults a spam verdict on the field it names, creating nothing", async () => {
    mock_evaluate.mockResolvedValueOnce({
      is_spam: true,
      spam_score: 0.95,
      category: "suspicious_email",
      explanation: "disposable email domain",
      field: "email",
    });

    const res: any = await us_action({ ...doc_args(post(US_LEAD)) } as any);

    expect(res.data.errors.email).toBe("disposable email domain");
    expect(await all_users()).toHaveLength(0);
    expect(await all_regs()).toHaveLength(0);
  }, 30_000);

  it("mints no second user for an address that already has a draft", async () => {
    await us_action({ ...doc_args(post(US_LEAD)) } as any);
    issued.length = 0;
    sent_links.length = 0;

    const res: any = await us_action({
      ...doc_args(post({ ...US_LEAD, o_ein: "98-7654321" })),
    } as any);

    expect(await all_users()).toHaveLength(1);
    // no second grant — a grant is only ever minted for an account just created
    expect(issued).toHaveLength(0);
    // the link is how they get back in
    expect(sent_links.at(-1)?.email).toBe(LEAD_EMAIL);
    const reg = (await all_regs()).at(-1)!;
    expect(check_email(res)).toEqual({
      pathname: "/check-email",
      email: LEAD_EMAIL,
      redirect: `/register/${reg.id}/1`,
    });
  }, 30_000);

  it("answers a verified address exactly as it answers an unverified one", async () => {
    await verified_account(LEAD_EMAIL);

    const res: any = await us_action({ ...doc_args(post(US_LEAD)) } as any);

    // byte-for-byte the answer the unverified case gets above — whether the
    // address already finished signing up is not this form's to disclose
    const reg = (await all_regs()).at(-1)!;
    expect(check_email(res)).toEqual({
      pathname: "/check-email",
      email: LEAD_EMAIL,
      redirect: `/register/${reg.id}/1`,
    });
    expect(sent_links.at(-1)?.email).toBe(LEAD_EMAIL);
    // and nothing they typed was thrown away: the application is waiting
    expect(reg.o_name).toBe("Riverside Youth Alliance");
    expect(issued).toHaveLength(0);
  }, 30_000);

  it("writes nothing when the browser is signed in as a different address", async () => {
    const cookie = await sign_in("someone.else@example.org");

    const res: any = await us_action({
      ...doc_args(post_as(cookie, US_LEAD)),
    } as any);

    expect(res.init.status).toBe(400);
    expect(res.data.signed_in_as).toBe("someone.else@example.org");
    // no field is wrong, so no field is marked
    expect(res.data.errors).toEqual({});
    // and what they typed survives the round trip
    expect(res.data.values.o_name).toBe("Riverside Youth Alliance");
    // only the signed-in account exists; no row was written under the lead
    expect(await all_users()).toHaveLength(1);
    expect(await all_regs()).toHaveLength(0);
  }, 30_000);

  it("takes a signed-in applicant straight into the wizard", async () => {
    const cookie = await sign_in(LEAD_EMAIL);

    const res: any = await us_action({
      ...doc_args(post_as(cookie, US_LEAD)),
    } as any);

    const reg = (await all_regs()).at(-1)!;
    expect(res.headers.get("location")).toBe(`/register/${reg.id}/1`);
    // the address is already proven — nothing to mail, nothing to grant
    expect(sent_links).toHaveLength(0);
    expect(issued).toHaveLength(0);
  }, 30_000);

  it("starts an international application from the eligibility form", async () => {
    const res: any = await intl_action({
      ...doc_args(
        post(INTL_LEAD, "https://bg.test/for-international-nonprofits")
      ),
    } as any);

    const [reg] = await all_regs();
    expect(reg!.o_type).toBe("other");
    expect(reg!.o_hq_country).toBe("Kenya");
    expect(reg!.o_registration_number).toBe("ke-99");
    expect(reg!.o_name).toBe("Global Aid Kenya");
    expect(res.headers.get("location")).toBe(`/register/${reg!.id}/1`);
  }, 30_000);

  it("keeps an all-digit registration number a string", async () => {
    await intl_action({
      ...doc_args(
        post(
          { ...INTL_LEAD, o_registration_number: "1234567" },
          "https://bg.test/for-international-nonprofits"
        )
      ),
    } as any);

    const [reg] = await all_regs();
    expect(reg!.o_registration_number).toBe("1234567");
  }, 30_000);

  it("faults a missing country under its own field and creates nothing", async () => {
    const { o_hq_country: _, ...without } = INTL_LEAD;
    const res: any = await intl_action({
      ...doc_args(
        post(without, "https://bg.test/for-international-nonprofits")
      ),
    } as any);

    expect(res.data.errors.o_hq_country).toBe(
      "Select your country of registration."
    );
    expect(res.data.errors.o_registration_number).toBeUndefined();
    expect(await all_users()).toHaveLength(0);
    expect(await all_regs()).toHaveLength(0);
  }, 30_000);

  it("faults a missing registration number under its own field", async () => {
    const { o_registration_number: _, ...without } = INTL_LEAD;
    const res: any = await intl_action({
      ...doc_args(
        post(without, "https://bg.test/for-international-nonprofits")
      ),
    } as any);

    expect(res.data.errors.o_registration_number).toBe(
      "Enter your registration number."
    );
    expect(await all_users()).toHaveLength(0);
  }, 30_000);

  it("reports an already-registered identity on the field that matched, leaving no account behind", async () => {
    await seed_owned_npo("123456789", "Riverside Youth Alliance");

    const res: any = await us_action({ ...doc_args(post(US_LEAD)) } as any);

    expect(res.data.errors.o_ein).toContain("already registered");
    expect(await all_regs()).toHaveLength(0);
    // the account is written only once the application it belongs to is
    // (the seeded listing's own member is the only other row here)
    const emails = (await all_users()).map((u) => u.email);
    expect(emails).not.toContain(LEAD_EMAIL);
  }, 30_000);

  it("faults a missing organization name and email together", async () => {
    const res: any = await us_action({
      ...doc_args(
        post({
          o_type: "501c3",
          o_name: "",
          o_ein: "12-3456789",
          email: "nope",
        })
      ),
    } as any);

    expect(res.data.errors.o_name).toBeTruthy();
    expect(res.data.errors.email).toBeTruthy();
    expect(await all_users()).toHaveLength(0);
  }, 30_000);
});

// --- the contact step, before the address is proven ---

/** run the marketing form and hand back what it created */
async function lead(fields: Record<string, string> = US_LEAD) {
  const res: any = await us_action({ ...doc_args(post(fields)) } as any);
  const location: string = res.headers.get("location");
  return { reg_id: location.split("/")[2]!, cookie: grant() };
}

/** `raw` is the path as it arrives — a client navigation asks for
 * `<path>.data`, or `<path>/_.data` with a trailing slash — while `url` is the
 * normalized one react-router hands every loader. */
const step_args = (
  reg_id: string,
  cookie?: string,
  step = "1",
  raw = `/register/${reg_id}/${step}`
) => ({
  params: { reg_id },
  request: req(`https://bg.test${raw}`, cookie),
  url: new URL(`https://bg.test/register/${reg_id}/${step}`),
  context: {} as any,
});

const patch_args = (
  reg_id: string,
  cookie: string | undefined,
  body: object
) => ({
  params: { reg_id },
  ...doc_args(
    req(`https://bg.test/register/${reg_id}/1`, cookie, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  ),
  context: {} as any,
});

const CONTACT = {
  update_type: "contact",
  r_first_name: "Jane",
  r_last_name: "Doe",
  r_org_role: "ceo",
  rm: "search-engines",
  o_name: "Riverside Youth Alliance",
} as const;

describe("the contact step before the address is proven", () => {
  it("opens to the grant holder, prefilled with what the lead form collected", async () => {
    const { reg_id, cookie } = await lead();

    const reg: any = await step_loader(1)(step_args(reg_id, cookie) as any);

    expect(reg.o_name).toBe("Riverside Youth Alliance");
    expect(reg.r_id).toBe(LEAD_EMAIL);

    // the chrome above it reads the same row and must not bounce them either
    const parent: any = await reg_loader(step_args(reg_id, cookie) as any);
    expect(parent.reg.id).toBe(reg_id);
  }, 30_000);

  it("is not bounced by the wizard's own layout on the way in", async () => {
    const { reg_id, cookie } = await lead();

    // `/register` wraps every step — a session-only gate here would send the
    // lead straight back to /signup before the step loader ever ran
    const res: any = await reg_layout_loader(step_args(reg_id, cookie) as any);
    expect(res.email).toBe(LEAD_EMAIL);
  }, 30_000);

  it("refuses a grant holder someone else's application", async () => {
    const { cookie } = await lead();
    const other = await reg_put({
      r_id: "someone.else@example.org",
      o_type: "501c3",
      o_ein: "987654321",
      o_hq_country: "United States",
    });

    await expect(
      step_loader(1)(step_args(other, cookie) as any)
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      reg_loader(step_args(other, cookie) as any)
    ).rejects.toMatchObject({ status: 403 });
  }, 30_000);

  it("refuses a request carrying no grant at all", async () => {
    const { reg_id } = await lead();

    const res: any = await step_loader(1)(step_args(reg_id) as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("mails the verification link when the step is submitted, and says so", async () => {
    const { reg_id, cookie } = await lead();
    sent_links.length = 0;

    const res: any = await update_action(next_step[1], { registrant: true })(
      patch_args(reg_id, cookie, CONTACT) as any
    );

    expect(sent_links.at(-1)?.email).toBe(LEAD_EMAIL);
    expect(res.headers.get("location")).toContain("/check-email");
    // the link lands them on the step after the one they just finished
    expect(sent_links.at(-1)?.url).toContain(
      encodeURIComponent(`/register/${reg_id}/2`)
    );

    const [row] = await all_regs();
    expect(row!.r_first_name).toBe("Jane");
  }, 30_000);
});

/** the screen that starts an application, reached with no path of its own */
const index_args = (cookie?: string) => ({
  params: {},
  ...doc_args(req("https://bg.test/register", cookie)),
  context: {} as any,
});

describe("a lead who comes back before proving the address", () => {
  it("lands back in the application they already started", async () => {
    const { reg_id, cookie } = await lead();

    const res: any = await reg_index_loader(index_args(cookie) as any);

    // closing the tab is not abandoning the application — the grant is still
    // good, and this is the one screen they can reach without a session
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/register/${reg_id}/1`);
  }, 30_000);

  it("drops them at the step the application actually reached", async () => {
    const { reg_id, cookie } = await lead();
    await update_action(next_step[1], { registrant: true })(
      patch_args(reg_id, cookie, CONTACT) as any
    );

    const res: any = await reg_index_loader(index_args(cookie) as any);

    expect(res.headers.get("location")).toBe(`/register/${reg_id}/2`);
  }, 30_000);

  it("is keyed on the grant's own address, never whichever row moved last", async () => {
    const { reg_id, cookie } = await lead();
    // written after theirs, so ordering alone would hand it over
    await reg_put({
      r_id: "someone.else@example.org",
      o_type: "501c3",
      o_ein: "987654321",
      o_hq_country: "United States",
    });

    const res: any = await reg_index_loader(index_args(cookie) as any);

    expect(res.headers.get("location")).toBe(`/register/${reg_id}/1`);
  }, 30_000);

  it("stops resolving once the address behind it is proven", async () => {
    const { cookie } = await lead();
    await test_db
      .current!.db.update(user_table)
      .set({ emailVerified: true })
      .where(eq(user_table.email, LEAD_EMAIL));

    const res: any = await reg_index_loader(index_args(cookie) as any);

    // a verified account holds a real session; a stale grant must not be a
    // second key to the row it now owns
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("sends a browser carrying neither session nor grant to auth", async () => {
    await lead();

    const res: any = await reg_index_loader(index_args() as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("leaves a signed-in visitor on the screen that starts an application", async () => {
    const cookie = await sign_in("staff@example.org");

    const res: any = await reg_index_loader(index_args(cookie) as any);

    expect(res).not.toBeInstanceOf(Response);
    expect(res.reference).toBe("");
  }, 30_000);

  it("remembers the new reference so the resume field is prefilled", async () => {
    const { reg_id } = await lead();

    // the strip on /register reads this back; without it a lead who lands
    // there has nothing to quote
    expect(vi.mocked(reg_cookie.serialize)).toHaveBeenCalledWith(
      expect.objectContaining({ reference: reg_id })
    );
  }, 30_000);
});

describe("the grant reaches nothing else", () => {
  it("closes a child of the wizard layout that has no loader of its own", async () => {
    const { reg_id, cookie } = await lead();

    // `sign-result` adds no loader — without the layout naming which child the
    // grant is for, it would inherit access by existing
    const res: any = await reg_loader(
      step_args(reg_id, cookie, "sign-result") as any
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("opens the identity screen, the one correction a lead can still make", async () => {
    const { reg_id, cookie } = await lead();

    const res: any = await reg_loader(
      step_args(reg_id, cookie, "identity") as any
    );
    expect(res.reg.id).toBe(reg_id);
  }, 30_000);

  it("answers a client navigation as it answers the document", async () => {
    const { reg_id, cookie } = await lead();
    const data = `?_routes=${encodeURIComponent("routes/_app.register.$reg_id")}`;

    const open: any = await reg_loader(
      step_args(
        reg_id,
        cookie,
        "identity",
        `/register/${reg_id}/identity.data${data}`
      ) as any
    );
    expect(open.reg.id).toBe(reg_id);

    const slashed: any = await reg_loader(
      step_args(
        reg_id,
        cookie,
        "identity/",
        `/register/${reg_id}/identity/_.data${data}`
      ) as any
    );
    expect(slashed.reg.id).toBe(reg_id);

    const closed: any = await reg_loader(
      step_args(
        reg_id,
        cookie,
        "sign-result",
        `/register/${reg_id}/sign-result.data${data}`
      ) as any
    );
    const to_signin = closed.headers.get("location");
    expect(to_signin).toContain("/signup");
    // the sign-in comes back to the page, not to its data endpoint
    expect(to_signin).not.toContain(".data");
    expect(to_signin).not.toContain("_routes");
  }, 30_000);

  it("closes every later step to it", async () => {
    const { reg_id, cookie } = await lead();

    const res: any = await step_loader(2)(
      step_args(reg_id, cookie, "2") as any
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("closes an action that was not opened to it", async () => {
    const { reg_id, cookie } = await lead();

    const res: any = await update_action(next_step[1])(
      patch_args(reg_id, cookie, CONTACT) as any
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signup");
  }, 30_000);

  it("refuses to write anything but the contact step", async () => {
    const { reg_id, cookie } = await lead();

    await expect(
      update_action(next_step[1], { registrant: true })(
        patch_args(reg_id, cookie, {
          update_type: "banking",
          o_bank_id: "wise-1",
        }) as any
      )
    ).rejects.toMatchObject({ status: 403 });
  }, 30_000);
});

describe("resume_application", () => {
  const someone_elses = () =>
    reg_put({
      r_id: "owner@example.org",
      o_type: "501c3",
      o_ein: "987654321",
      o_hq_country: "United States",
    });

  it("says the same thing to a non-owner as to an unknown reference", async () => {
    const id = await someone_elses();
    const cookie = await sign_in("nosy@example.org");

    const res: any = await resume_application(
      req("https://bg.test/register", cookie),
      new URL("https://bg.test/register"),
      form({ reference: JSON.stringify(id) })
    );

    // existence is not disclosed: no redirect, and the same message an
    // unknown reference gets
    expect(res).not.toBeInstanceOf(Response);
    expect(res.errors.reference.message).toContain("couldn't find");
  }, 30_000);

  it("still resumes the owner's own application", async () => {
    const id = await someone_elses();
    const cookie = await sign_in("owner@example.org");

    const res: any = await resume_application(
      req("https://bg.test/register", cookie),
      new URL("https://bg.test/register"),
      form({ reference: JSON.stringify(id) })
    );

    expect(res.headers.get("location")).toBe(`/register/${id}/1`);
  }, 30_000);
});
