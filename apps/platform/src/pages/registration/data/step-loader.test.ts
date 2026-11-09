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

const routing = vi.hoisted(() => ({ on: true }));
vi.mock("$/env", async (importOriginal) => {
  const env = await importOriginal<typeof import("$/env")>();
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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ session: true })
);

import { get_session } from "#/.server/auth";
import { create_test_db } from "$/pg/test-utils/pglite";
import { reg_loader, step_loader } from "./step-loader";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";

/** a 501(c)(3) past identity with a stripe account and no bank */
const STRIPE_ONLY = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
  o_website: "https://example.org",
  o_hq_country: "United States",
  o_designation: "Charity",
  o_type: "501c3",
  o_ein: "123456789",
  o_stripe_account_id: "acct_1",
} as const;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  routing.on = true;
  await test_db.current!.db.delete(registrations);
  await test_db
    .current!.db.insert(registrations)
    .values({ id: RID, r_id: EMAIL, status: "01", ...STRIPE_ONLY });
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

const args = (path: string) => {
  const url = new URL(`http://localhost/register/${RID}/${path}`);
  return {
    request: new Request(url),
    url,
    params: { reg_id: RID },
    context: {} as any,
  } as any;
};

describe("step_loader", () => {
  test("opens the summary to a stripe-only application while routing is on", async () => {
    const res = await step_loader(5)(args("5"));

    expect(res).not.toBeInstanceOf(Response);
  });

  // stripe pays nobody with routing off, so the account is no answer to banking
  test("sends a stripe-only application back to banking while routing is off", async () => {
    routing.on = false;

    const res = (await step_loader(5)(args("5"))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("../4");
  });

  // step 4 would send it straight back to the summary: a redirect loop
  test("opens the summary to a submitted stripe-only application while routing is off", async () => {
    routing.on = false;
    await test_db.current!.db.update(registrations).set({ status: "02" });

    const res = await step_loader(5)(args("5"));

    expect(res).not.toBeInstanceOf(Response);
  });

  test("opens the summary to a submitted application whose stripe account was disconnected", async () => {
    await test_db
      .current!.db.update(registrations)
      .set({ status: "02", o_stripe_account_id: null });

    const res = await step_loader(5)(args("5"));

    expect(res).not.toBeInstanceOf(Response);
  });

  test("still sends a submitted application from a step to its summary", async () => {
    routing.on = false;
    await test_db.current!.db.update(registrations).set({ status: "02" });

    const res = (await step_loader(4)(args("4"))) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/register/${RID}/5`);
  });
});

describe("reg_loader", () => {
  // the step bar is drawn client-side, which cannot read the switch itself
  test.each([true, false])(
    "hands the chrome the routing switch: %s",
    async (on) => {
      routing.on = on;

      const res = await reg_loader(args("5"));

      expect(res).toMatchObject({ connect_routing: on });
    }
  );
});
