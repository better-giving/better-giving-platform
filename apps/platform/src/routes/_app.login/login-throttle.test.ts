import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const test_auth_ref = vi.hoisted(() => ({ current: null as any }));

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
  auth: new Proxy({}, { get: (_, prop) => test_auth_ref.current[prop] }),
  get_session: vi.fn(async () => ({ user: undefined })),
}));

vi.mock("#/.server/auth/login-link", () => ({
  check_email_url: vi.fn(() => "/check-email"),
  request_login_link: vi.fn(),
}));

vi.mock("#/.server/toast", () => ({
  dataWithError: vi.fn((_: unknown, msg: string) => ({ toast_error: msg })),
}));

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

// --- imports (after mocks hoisted) ---

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import { auth_options } from "#/.server/auth/options";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_password_user } from "#/__tests__/fixtures/password-user";
import { referral_id } from "#/helpers/referral";
import * as schema from "$/pg/schema";
import { account, session, user as user_table } from "$/pg/schema/auth";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action } from "./route";

const THROTTLED = "Too many sign-in attempts. Try again in a few minutes.";
const VICTIM = "victim@example.com";
const RIGHT_PW = "Correct-horse-1";

beforeAll(async () => {
  test_db.current = await create_test_db();
  test_auth_ref.current = betterAuth({
    ...auth_options({ send_login_link: async () => {}, referral_id }),
    secret: "test-secret-at-least-32-characters-long!!",
    baseURL: "https://app.test",
    basePath: "/api/auth",
    database: drizzleAdapter(test_db.current.db, { provider: "pg", schema }),
  });
});

beforeEach(async () => {
  reset_rate_limits();
  const db = test_db.current!.db;
  await db.delete(session);
  await db.delete(account);
  await db.delete(user_table);
  await seed_password_user(test_auth_ref.current, {
    email: VICTIM,
    password: RIGHT_PW,
    name: "Vic",
    first_name: "Vic",
    last_name: "Tim",
  });
  await db
    .update(user_table)
    .set({ emailVerified: true })
    .where(eq(user_table.email, VICTIM));
});

const attempt = (email: string, password: string, ip = "203.0.113.7") => {
  const fv = new FormData();
  fv.set("email", email);
  fv.set("password", password);
  const request = new Request("https://app.test/login", {
    method: "POST",
    body: fv,
    headers: { "x-forwarded-for": ip },
  });
  return (action as any)({ ...doc_args(request), params: {}, context: {} });
};

/** the password-field error the action returns instead of a redirect */
const password_error = (res: unknown): string | undefined =>
  (res as { errors?: { password?: { message?: string } } }).errors?.password
    ?.message;

describe("/login password throttle", () => {
  it("shows the throttle on the password field after five wrong passwords", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await attempt("Victim@Example.com", "wrong-guess");
      expect(password_error(res)).toMatch(/invalid email or password/i);
    }

    const sixth = await attempt(VICTIM, RIGHT_PW);

    expect(password_error(sixth)).toBe(THROTTLED);
  });

  it("hands sign-in the caller's ip, so the per-ip cap binds /login", async () => {
    for (let i = 0; i < 20; i++) await attempt(`user${i}@example.com`, "guess");

    expect(password_error(await attempt(VICTIM, RIGHT_PW))).toBe(THROTTLED);

    const other_ip = await attempt(VICTIM, RIGHT_PW, "198.51.100.9");
    expect(other_ip).toBeInstanceOf(Response);
    expect((other_ip as Response).status).toBe(302);
  });
});
