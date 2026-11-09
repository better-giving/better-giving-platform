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
vi.mock("#/.server/cookie", () => ({
  reg_cookie: { parse: vi.fn(async () => ({})) },
}));

import { get_registrant, get_session } from "#/.server/auth";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  routing.on = true;
  await test_db.current!.db.delete(registrations);
  // a 501(c)(3) through identity, holding a stripe account and no bank
  await test_db.current!.db.insert(registrations).values({
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
    o_stripe_account_id: "acct_1",
  });
  // a lead who holds only a draft grant, no session
  vi.mocked(get_session).mockResolvedValue({ user: null } as any);
  vi.mocked(get_registrant).mockResolvedValue({
    id: "u-1",
    email: EMAIL,
    role: null,
  } as any);
});

const load = () => {
  const url = new URL("http://localhost/register");
  return loader({ request: new Request(url), url, params: {} } as any);
};

describe("register index loader", () => {
  // a lead holding only a grant is handed straight back to their application
  test.each([
    [true, 5],
    [false, 4],
  ])("sends a grant holder, routing %s, to step %i", async (on, step) => {
    routing.on = on;

    const res = (await load()) as Response;

    expect(res.headers.get("location")).toBe(`/register/${RID}/${step}`);
  });
});
