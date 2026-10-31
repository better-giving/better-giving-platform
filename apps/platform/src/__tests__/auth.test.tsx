import { createRoutesStub } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- hoisted refs ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const test_auth_ref = vi.hoisted(() => ({ current: null as any }));
const mock_send_email = vi.hoisted(() => vi.fn());
const sent_links = vi.hoisted(() => [] as { email: string; url: string }[]);
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

/** the pglite-backed instance, reachable before `beforeAll` builds it */
const test_auth_proxy = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (!test_auth_ref.current) throw new Error("test auth not init");
          return (test_auth_ref.current as any)[prop];
        },
      }
    )
);

// what the real server-side seams import as `./auth`
vi.mock("#/.server/auth/auth", () => ({ auth: test_auth_proxy }));

vi.mock("#/.server/auth", async () => ({
  auth: test_auth_proxy,
  get_session: vi.fn(async (request: Request) => {
    if (!test_auth_ref.current) throw new Error("test auth not init");
    const session = await test_auth_ref.current.api.getSession({
      headers: request.headers,
    });
    return { user: session?.user };
  }),
  to_auth: vi.fn(
    () => new Response(null, { status: 302, headers: { location: "/login" } })
  ),
  create_unverified_user: vi.fn(async (input: { email: string }) => {
    const ctx = await test_auth_ref.current.$context;
    const email = input.email.trim().toLowerCase();
    const found = await ctx.internalAdapter.findUserByEmail(email);
    if (found) {
      return found.user.emailVerified
        ? { status: "verified" }
        : { status: "existing", user_id: found.user.id };
    }
    const created = await ctx.internalAdapter.createUser({
      email,
      name: "",
      first_name: "",
      last_name: "",
      emailVerified: false,
    });
    return { status: "created", user_id: created.id };
  }),
  request_password_reset: (
    await vi.importActual<typeof import("#/.server/auth/password-reset")>(
      "#/.server/auth/password-reset"
    )
  ).request_password_reset,
}));

vi.mock("#/.server/cookie", () => ({
  reg_cookie: {
    parse: vi.fn(async () => ({})),
    serialize: vi.fn(async () => "bg-registration=x"),
  },
}));

vi.mock("#/routes/_app.signup._index/evaluate", () => ({
  evaluate: mock_evaluate,
  evaluate_org: mock_evaluate,
}));

vi.mock("#/.server/toast", () => ({
  dataWithError: (_data: any, message: string, init?: ResponseInit) =>
    new Response(JSON.stringify({ error: message }), {
      status: init?.status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
  dataWithSuccess: (_data: any, message: string) =>
    new Response(JSON.stringify({ success: message }), {
      headers: { "Content-Type": "application/json" },
    }),
  redirectWithSuccess: (url: string) =>
    new Response(null, { status: 302, headers: { location: url } }),
  getToast: vi.fn(),
}));

vi.mock("emails", () => ({
  login_link: { template: () => ({ node: null, subject: "Sign in" }) },
  reset_password: { template: () => ({ node: null, subject: "Reset" }) },
}));

// --- imports (after mocks) ---

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { eq } from "drizzle-orm";
import { auth_options, login_link_plugin } from "#/.server/auth/options";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_password_user } from "#/__tests__/fixtures/password-user";
import { referral_id } from "#/helpers/referral";
import {
  action as check_email_action,
  loader as check_email_loader,
} from "#/routes/_app.check-email/api";
import CheckEmailPage from "#/routes/_app.check-email/route";
import LoginPage, {
  action as login_action,
  loader as login_loader,
} from "#/routes/_app.login/route";
import {
  action as reset_action,
  loader as reset_loader,
} from "#/routes/_app.login_.reset/api";
import ResetPage from "#/routes/_app.login_.reset/route";
// route components & actions/loaders
import SignupPage, {
  action as signup_action,
  loader as signup_loader,
} from "#/routes/_app.signup._index/route";
import SuccessPage from "#/routes/_app.signup.success/route";
import * as schema from "$/pg/schema";
import {
  account,
  session,
  user as user_table,
  verification,
} from "$/pg/schema/auth";
import { create_test_db } from "$/pg/test-utils/pglite";

// --- constants ---

const BASE_URL = "http://localhost:4200";
const TEST_SECRET = "test-secret-at-least-32-characters-long!!";
const TEST_EMAIL = "jane@example.com";
const TEST_PW = "Test1234!@";

// --- test context ---

/** seed a verified user via auth API (not UI — used for login test setup) */
async function create_verified_user(
  email = TEST_EMAIL,
  password = TEST_PW,
  first_name = "Jane",
  last_name = "Doe"
) {
  await seed_password_user(test_auth_ref.current, {
    email,
    password,
    name: `${first_name} ${last_name}`,
    first_name,
    last_name,
  });
  // flip verification directly: an email proof (link/otp) landing on an
  // unverified row deletes its credential account by design, and these tests
  // are about users who already have a working password.
  await test_db
    .current!.db.update(user_table)
    .set({ emailVerified: true })
    .where(eq(user_table.email, email));
}

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

  const test_auth = betterAuth({
    ...auth_options(deps),
    plugins: [login_link_plugin(deps), admin()],
    secret: TEST_SECRET,
    baseURL: BASE_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(test_db.current.db, { provider: "pg", schema }),
    emailAndPassword: {
      ...auth_options(deps).emailAndPassword,
      async sendResetPassword({ user, url }) {
        mock_send_email({ type: "reset", email: user.email, url });
      },
    },
  });

  test_auth_ref.current = test_auth;
  await test_auth.$context;
}, 30_000);

beforeEach(async () => {
  reset_rate_limits();
  await test_db.current!.db.delete(verification);
  await test_db.current!.db.delete(session);
  await test_db.current!.db.delete(account);
  await test_db.current!.db.delete(user_table);
  mock_send_email.mockClear();
  sent_links.length = 0;
  mock_evaluate.mockClear();
  mock_evaluate.mockResolvedValue({
    is_spam: false,
    spam_score: 0,
    explanation: "ok",
    field: "email",
  });
});

afterAll(async () => {
  await test_db.current?.client.close();
});

// --- route stubs ---

function signup_stub() {
  return createRoutesStub([
    {
      path: "/signup",
      Component: SignupPage,
      ErrorBoundary: () => <div data-testid="error-boundary">error</div>,
      action: signup_action,
      loader: signup_loader,
    },
    {
      path: "/check-email",
      Component: CheckEmailPage,
      action: check_email_action,
      loader: check_email_loader,
    },
    {
      path: "/signup/success",
      Component: SuccessPage,
      loader: signup_loader,
    },
    {
      // login redirect target — just a sentinel
      path: "/login",
      Component: () => <div data-testid="login-page">login</div>,
    },
    {
      path: "/marketplace",
      Component: () => <div data-testid="marketplace">marketplace</div>,
    },
  ]);
}

function login_stub() {
  return createRoutesStub([
    {
      path: "/login",
      Component: LoginPage,
      action: login_action,
      loader: login_loader,
    },
    {
      path: "/check-email",
      Component: () => <div data-testid="check-email-page">check email</div>,
    },
    {
      path: "/login/reset",
      Component: () => <div data-testid="reset-page">reset</div>,
    },
    {
      path: "/marketplace",
      Component: () => <div data-testid="marketplace">marketplace</div>,
    },
    {
      path: "/dashboard",
      Component: () => <div data-testid="dashboard">dashboard</div>,
    },
  ]);
}

function reset_stub() {
  return createRoutesStub([
    {
      path: "/login/reset",
      Component: ResetPage,
      action: reset_action,
      loader: reset_loader,
    },
    {
      path: "/login",
      Component: () => <div data-testid="login-page">login</div>,
    },
  ]);
}

// --- tests ---

describe("signup → verification link", () => {
  it("fills form, submits, and is told to check the inbox", async () => {
    const Stub = signup_stub();
    const screen = await render(<Stub initialEntries={["/signup"]} />);

    // fill signup form
    await screen.getByPlaceholder(/first name/i).fill("Jane");
    await screen.getByPlaceholder(/last name/i).fill("Doe");
    // two email fields — email and confirm
    const email_inputs = screen.getByPlaceholder(/email address/i);
    await email_inputs.nth(0).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/confirm email/i).fill(TEST_EMAIL);

    await screen.getByRole("button", { name: "Sign Up", exact: true }).click();

    await expect.element(screen.getByText(/check your inbox/i)).toBeVisible();

    // the mail carries a single-use link, never a code to retype
    const link = sent_links.filter((l) => l.email === TEST_EMAIL).at(-1);
    expect(link).toBeTruthy();
    expect(link!.url).toContain("/magic-link/verify");
    expect(link!.url).not.toMatch(/\b\d{6}\b/);
  });

  it("tells a user with a dead link to request a new one", async () => {
    await seed_password_user(test_auth_ref.current, {
      email: TEST_EMAIL,
      password: TEST_PW,
      name: "Jane Doe",
      first_name: "Jane",
      last_name: "Doe",
    });

    const Stub = signup_stub();
    const screen = await render(
      <Stub
        initialEntries={[
          `/check-email?email=${encodeURIComponent(TEST_EMAIL)}&stale=1`,
        ]}
      />
    );

    await expect.element(screen.getByText(/link has expired/i)).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /send a new link/i }))
      .toBeVisible();
  });

  it("resends a fresh link on request", async () => {
    await seed_password_user(test_auth_ref.current, {
      email: TEST_EMAIL,
      password: TEST_PW,
      name: "Jane Doe",
      first_name: "Jane",
      last_name: "Doe",
    });
    sent_links.length = 0;

    const Stub = signup_stub();
    const screen = await render(
      <Stub
        initialEntries={[
          `/check-email?email=${encodeURIComponent(TEST_EMAIL)}&stale=1`,
        ]}
      />
    );

    await screen.getByRole("button", { name: /send a new link/i }).click();

    await vi.waitFor(() => {
      expect(sent_links.some((l) => l.email === TEST_EMAIL)).toBe(true);
    });
  });

  it("rejects spam signup and shows field error", async () => {
    mock_evaluate.mockResolvedValueOnce({
      is_spam: true,
      spam_score: 0.95,
      category: "spam",
      explanation: "suspicious email pattern",
      field: "email",
    });

    const Stub = signup_stub();
    const screen = await render(<Stub initialEntries={["/signup"]} />);

    await screen.getByPlaceholder(/first name/i).fill("Jane");
    await screen.getByPlaceholder(/last name/i).fill("Doe");
    await screen
      .getByPlaceholder(/email address/i)
      .nth(0)
      .fill(TEST_EMAIL);
    await screen.getByPlaceholder(/confirm email/i).fill(TEST_EMAIL);

    await screen.getByRole("button", { name: "Sign Up", exact: true }).click();

    await expect
      .element(screen.getByText(/suspicious email pattern/i))
      .toBeVisible();
  });

  it("signup with existing verified email still shows check-email", async () => {
    // better-auth returns 200 to avoid email enumeration
    await create_verified_user();

    const Stub = signup_stub();
    const screen = await render(<Stub initialEntries={["/signup"]} />);

    await screen.getByPlaceholder(/first name/i).fill("Jane");
    await screen.getByPlaceholder(/last name/i).fill("Doe");
    await screen
      .getByPlaceholder(/email address/i)
      .nth(0)
      .fill(TEST_EMAIL);
    await screen.getByPlaceholder(/confirm email/i).fill(TEST_EMAIL);

    await screen.getByRole("button", { name: "Sign Up", exact: true }).click();

    // same screen either way — the flow never leaks that the user exists
    await expect.element(screen.getByText(/check your inbox/i)).toBeVisible();
  });

  it("hands the whole referral target to login after signup", async () => {
    // to_auth copies the arrival query onto /signup, so the target can carry
    // more than one param — every one of them must reach login intact
    const target = "/register/welcome?utm_source=nl&referrer=ABC123";

    const Stub = signup_stub();
    const screen = await render(
      <Stub
        initialEntries={[
          `/signup/success?redirect=${encodeURIComponent(target)}`,
        ]}
      />
    );

    const link = screen.getByRole("link", { name: /continue to sign in/i });
    await expect.element(link).toBeVisible();

    const to = (link.element() as HTMLAnchorElement).getAttribute("href") ?? "";
    const redirect = new URL(to, BASE_URL).searchParams.get("redirect");
    expect(redirect).toBe(target);
  });
});

describe("login flow", () => {
  it("signs in with valid credentials → redirects to marketplace", async () => {
    await create_verified_user();

    const Stub = login_stub();
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Philanthropy for Everyone");
    await screen.getByLabelText("Email", { exact: true }).fill(TEST_EMAIL);
    await screen.getByLabelText("Password", { exact: true }).fill(TEST_PW);
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByTestId("marketplace")).toBeVisible();
  });

  it("explains a google sign-in that hit an unconfirmed account", async () => {
    const Stub = login_stub();
    const screen = await render(
      <Stub
        initialEntries={[
          "/login?redirect=%2Fdashboard&error=account_not_linked",
        ]}
      />
    );

    const alert = screen.getByRole("alert");
    await expect.element(alert).toMatchTextContent(/hasn't been confirmed/i);
    const link = alert.getByRole("link", { name: /fresh sign-in link/i });
    const to = new URL(
      (link.element() as HTMLAnchorElement).href,
      window.location.origin
    );
    expect(to.pathname).toBe("/signup");
    expect(to.searchParams.get("redirect")).toBe("/dashboard");
  });

  it("drops the google error once the password form is used", async () => {
    await create_verified_user();

    const Stub = login_stub();
    const screen = await render(
      <Stub initialEntries={["/login?error=access_denied"]} />
    );
    await expect.element(screen.getByRole("alert")).toBeVisible();

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill("WrongPass1!");
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByText(/invalid/i)).toBeVisible();
    await expect
      .element(screen.getByText(/google sign-in didn't finish/i))
      .not.toBeInTheDocument();
  });

  it("shows error for invalid credentials", async () => {
    await create_verified_user();

    const Stub = login_stub();
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill("WrongPass1!");
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByText(/invalid/i)).toBeVisible();
  });

  it("mails a link when a password holder has not proven their address", async () => {
    await seed_password_user(test_auth_ref.current, {
      email: TEST_EMAIL,
      password: TEST_PW,
      name: "Jane Doe",
      first_name: "Jane",
      last_name: "Doe",
    });

    const Stub = login_stub();
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill(TEST_PW);
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByTestId("check-email-page")).toBeVisible();
    expect(
      sent_links.filter((l) => l.email === TEST_EMAIL).at(-1)
    ).toBeTruthy();
  });

  it("mails a link when a passwordless lead tries to sign in", async () => {
    // the shape every marketing lead form leaves behind: a user row, no account
    // row of any kind, address never proven. it must not be read as migrated —
    // a password set from that prompt is deleted by the next link they click.
    await test_db.current!.db.insert(user_table).values({
      id: crypto.randomUUID(),
      name: "",
      email: TEST_EMAIL,
      emailVerified: false,
      first_name: "",
      last_name: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const Stub = login_stub();
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill("AnyPass1!");
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByTestId("check-email-page")).toBeVisible();
    expect(
      sent_links.filter((l) => l.email === TEST_EMAIL).at(-1)
    ).toBeTruthy();
  });

  it("sends a verified user with no password to set one", async () => {
    // insert user directly — simulates cognito migration. verified is what
    // separates them from a lead: the address is already proven, so the only
    // thing missing is a credential.
    await test_db.current!.db.insert(user_table).values({
      id: crypto.randomUUID(),
      name: "Migrated User",
      email: TEST_EMAIL,
      emailVerified: true,
      first_name: "Migrated",
      last_name: "User",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const Stub = login_stub();
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill("AnyPass1!");
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByTestId("reset-page")).toBeVisible();
    // a sign-in link here would be the wrong remedy, and would land them back
    // on a page asking for a password they still do not have
    expect(sent_links.filter((l) => l.email === TEST_EMAIL).at(-1)).toBeFalsy();
  });

  it("redirects to original page after login with ?redirect param", async () => {
    await create_verified_user();

    const Stub = login_stub();
    const screen = await render(
      <Stub initialEntries={["/login?redirect=/dashboard"]} />
    );

    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByPlaceholder(/password/i).fill(TEST_PW);
    await screen.getByRole("button", { name: /log in/i }).click();

    await expect.element(screen.getByTestId("dashboard")).toBeVisible();
  });
});

describe("password reset flow", () => {
  it("requests reset → check email → set password → success", async () => {
    await create_verified_user();
    mock_send_email.mockClear();

    const Stub = reset_stub();
    const screen = await render(<Stub initialEntries={["/login/reset"]} />);

    // step 1: init form — enter email
    await expect
      .element(screen.getByText(/reset your password/i))
      .toBeVisible();
    await screen.getByPlaceholder(/email address/i).fill(TEST_EMAIL);
    await screen.getByRole("button", { name: /send code/i }).click();

    // step 2: check email page
    await expect.element(screen.getByText(/check your email/i)).toBeVisible();

    // extract token from send_email mock
    // url format: {baseURL}/reset-password/{token}?callbackURL={encoded}
    const reset_call = mock_send_email.mock.calls.find(
      (c: any[]) => c[0]?.type === "reset"
    );
    expect(reset_call).toBeTruthy();
    const reset_url = new URL(reset_call![0].url);
    const token = reset_url.pathname.split("/reset-password/")[1];
    expect(token).toBeTruthy();

    // step 3: navigate to set-password with token (simulates clicking email link)
    await cleanup();
    const screen2 = await render(
      <Stub
        initialEntries={[
          `/login/reset?type=set-password&email=${encodeURIComponent(TEST_EMAIL)}&token=${token}`,
        ]}
      />
    );

    await expect.element(screen2.getByText(/set new password/i)).toBeVisible();
    await screen2
      .getByPlaceholder("New Password", { exact: true })
      .fill("NewPass1!@");
    await screen2
      .getByPlaceholder("Confirm New Password", { exact: true })
      .fill("NewPass1!@");
    await screen2.getByRole("button", { name: /confirm/i }).click();

    // step 4: success
    await expect
      .element(screen2.getByText(/password reset successful/i))
      .toBeVisible();
    await expect
      .element(screen2.getByRole("link", { name: /back to sign in/i }))
      .toBeVisible();
  });

  it("forgot password link on login navigates to reset page", async () => {
    const Stub = createRoutesStub([
      {
        path: "/login",
        Component: LoginPage,
        action: login_action,
        loader: login_loader,
      },
      {
        path: "/login/reset",
        Component: ResetPage,
        action: reset_action,
        loader: reset_loader,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/login"]} />);

    await screen.getByRole("link", { name: /forgot password/i }).click();

    await expect
      .element(screen.getByText(/reset your password/i))
      .toBeVisible();
  });
});
