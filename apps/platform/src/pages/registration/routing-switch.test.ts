import { createFormData } from "remix-hook-form";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { registrations } from "$/pg/schema/registration";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const routing = vi.hoisted(() => ({ on: true }));

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

vi.mock("$/env", async (orig) => {
  const env = await orig<typeof import("$/env")>();
  return {
    ...env,
    stripe: {
      ...env.stripe,
      get connect_routing() {
        return routing.on;
      },
    },
  };
});

vi.mock("$/kit/queue", () => ({ enqueue: vi.fn(async () => {}) }));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ session: true })
);

vi.mock("#/.server/cookie", () => ({
  reg_cookie: {
    parse: vi.fn(async () => ({})),
    serialize: vi.fn(async () => "bg-registration=x"),
  },
}));

import { get_session } from "#/.server/auth";
import { create_test_db } from "$/pg/test-utils/pglite";
import { change_identity } from "./change-identity";
import { resume_application } from "./resume-application";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";
const URL_ = new URL(`http://localhost/register/${RID}/1`);

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  routing.on = true;
  await test_db.current!.db.delete(registrations);
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

/** a 501(c)(3) through contact, org and identity, with no bank */
const seed = (o: Partial<typeof registrations.$inferInsert> = {}) =>
  test_db.current!.db.insert(registrations).values({
    id: RID,
    r_id: EMAIL,
    status: "01",
    r_first_name: "Jane",
    r_last_name: "Doe",
    o_name: "Test Org",
    r_org_role: "ceo",
    rm: "other",
    o_website: "https://test.org",
    o_hq_country: "United States",
    o_designation: "charity",
    o_type: "501c3",
    o_ein: "123456789",
    ...o,
  });

const location = (res: unknown) => (res as Response).headers.get("location");

const reidentify = () =>
  change_identity(
    new Request(URL_, { method: "POST" }),
    URL_,
    RID,
    createFormData({ o_type: "501c3", o_ein: "123456789" })
  );

const resume = () =>
  resume_application(
    new Request(URL_, { method: "POST" }),
    URL_,
    createFormData({ reference: RID })
  );

describe.each([
  ["change_identity", async () => location(await reidentify()), "../"],
  [
    "resume_application",
    async () => location(await resume()),
    `/register/${RID}/`,
  ],
] as const)("%s sends an application on", (_, go, prefix) => {
  test("to review with a stripe account only, routing on", async () => {
    await seed({ o_stripe_account_id: "acct_1" });

    expect(await go()).toBe(`${prefix}5`);
  });

  test("back to banking with a stripe account only, routing off", async () => {
    routing.on = false;
    await seed({ o_stripe_account_id: "acct_1" });

    expect(await go()).toBe(`${prefix}4`);
  });

  test("to banking, routing on, when it has neither a bank nor an account", async () => {
    await seed();

    expect(await go()).toBe(`${prefix}4`);
  });

  test("to review on a saved bank, whatever the switch says", async () => {
    routing.on = false;
    await seed({ o_bank_id: "777", o_bank_statement: "https://s/b.pdf" });

    expect(await go()).toBe(`${prefix}5`);
  });
});
