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
import { loader } from "#/routes/_app.register.$reg_id.identity/api";
import type { TStatus } from "@/reg/schema";
import { reg_get } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { change_identity } from "./change-identity";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";
const URL_ = new URL(`http://localhost/register/${RID}/identity`);

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

/** a 501(c)(3) through contact, org and identity, with a bank */
const seed = (status: TStatus) =>
  test_db.current!.db.insert(registrations).values({
    id: RID,
    r_id: EMAIL,
    status,
    status_rejected_reason:
      status === "04" ? "EIN could not be verified" : null,
    status_approved_npo_id: status === "03" ? 42 : null,
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
    o_bank_id: "777",
    o_bank_statement: "https://s/b.pdf",
  });

const reidentify = () =>
  Promise.resolve(
    change_identity(
      new Request(URL_, { method: "POST" }),
      URL_,
      RID,
      createFormData({ o_type: "501c3", o_ein: "987654321" })
    )
  ).catch((thrown: unknown) => {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  });

const open = () =>
  loader({
    params: { reg_id: RID },
    request: new Request(URL_),
    url: URL_,
  } as any);

const location = (res: unknown) =>
  res instanceof Response ? res.headers.get("location") : null;

// the rejection mail asks the applicant to rectify and resubmit; a wrong
// identity is the commonest thing to rectify
describe("a rejected application", () => {
  test("opens the identity form", async () => {
    await seed("04");

    const res = await open();

    expect(location(res)).toBeNull();
    expect(res).toMatchObject({ values: { o_ein: "123456789" } });
  });

  test("takes the new identity and goes back to draft, as any edit does", async () => {
    await seed("04");

    const res = await reidentify();

    expect(location(res)).toBe("../5");
    const row = await reg_get(RID);
    expect(row?.o_ein).toBe("987654321");
    expect(row?.status).toBe("01");
  });
});

describe.each<TStatus>(["02", "03"])("a %s application", (status) => {
  test("keeps the identity form shut", async () => {
    await seed(status);

    expect(location(await open())).toMatch(
      status === "02" ? /\/5$/ : /success/
    );
  });

  test("refuses an identity change, leaving the row as it was", async () => {
    await seed(status);

    const res = await reidentify();

    expect(location(res)).toMatch(status === "02" ? /\/5$/ : /success/);
    const row = await reg_get(RID);
    expect(row?.o_ein).toBe("123456789");
    expect(row?.status).toBe(status);
  });
});
