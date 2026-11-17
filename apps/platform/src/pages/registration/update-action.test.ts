import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TStatus } from "@/reg/schema";
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

import { get_session } from "#/.server/auth";
import { enqueue } from "$/kit/queue";
import { reg_get } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { type IUpdateActionOpts, update_action } from "./update-action";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";
const SEEN_AT = "2026-09-01T00:00:00.000Z";
/** the private store `.env.test`'s token names */
const STORE = "https://testprivate.private.blob.vercel-storage.com";
const OWN_DOC = `${STORE}/docs/u-1/statement-abc.pdf`;
const OTHERS_DOC = `${STORE}/docs/u-2/passport-xyz.pdf`;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
  vi.mocked(enqueue).mockClear();
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

const seed = (status: TStatus | null) =>
  test_db.current!.db.insert(registrations).values({
    id: RID,
    r_id: EMAIL,
    status,
    o_website: "https://before.org",
    updated_at: SEEN_AT,
  });

const save_org_step = () =>
  update_action("3")({
    request: new Request(`http://localhost/register/${RID}/2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_type: "org",
        o_website: "https://after.org",
      }),
    }),
    params: { reg_id: RID },
    context: {} as any,
  } as any);

/** a thrown `Response` is the refusal; anything else is the action's answer */
const settle = (p: unknown) =>
  Promise.resolve(p).then(
    (res) => res as Response,
    (thrown: unknown) => {
      if (thrown instanceof Response) return thrown;
      throw thrown;
    }
  );

describe("update_action — step save", () => {
  // a step form left open in another tab still posts after the applicant
  // submitted, or after review approved them. it lands where the step loader
  // would have sent that tab, not on an error page.
  test.each<[TStatus, string]>([
    ["02", `/register/${RID}/5`],
    ["03", "/register/success"],
  ])(
    "sends a %s application to %s and writes nothing",
    async (status, path) => {
      await seed(status);

      const res = await settle(save_org_step());

      expect(res.status).toBe(302);
      expect(
        new URL(res.headers.get("location")!, "http://localhost").pathname
      ).toBe(path);
      const row = await reg_get(RID);
      expect(row?.status).toBe(status);
      expect(row?.o_website).toBe("https://before.org");
      expect(enqueue).not.toHaveBeenCalled();
    }
  );

  test("refuses another user's save with 401 and writes nothing", async () => {
    await seed("01");
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u-2", email: "mallory@test.com", role: null } as any,
    });

    const res = await settle(save_org_step());

    expect(res.status).toBe(401);
    expect(await reg_get(RID)).toMatchObject({
      o_website: "https://before.org",
      updated_at: SEEN_AT,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // a rejected application is reopened by editing it; a legacy row with no
  // status is a draft, as the review step reads it.
  test.each<TStatus>(["01", "04"])(
    "saves a %s application back to draft",
    async (status) => {
      await seed(status);

      const res = await settle(save_org_step());

      expect(res.status).toBe(302);
      const row = await reg_get(RID);
      expect(row?.status).toBe("01");
      expect(row?.o_website).toBe("https://after.org");
      expect(enqueue).toHaveBeenCalledOnce();
    }
  );
});

describe("update_action — where a save lands", () => {
  // every step before review is filled; `o_bank_id` decides whether
  // `Progress` reads the application as on step 4 or 5
  const seed_banking = (o_bank_id: string | null) =>
    test_db.current!.db.insert(registrations).values({
      id: RID,
      r_id: EMAIL,
      status: "01",
      r_first_name: "Jane",
      r_last_name: "Doe",
      r_contact_number: "1234567890",
      o_name: "Test Org",
      r_org_role: "ceo",
      rm: "search-engines",
      o_website: "https://example.com",
      o_designation: "Charity",
      o_type: "501c3",
      o_ein: "123456789",
      o_hq_country: "United States",
      o_bank_id,
      o_bank_statement: o_bank_id && "https://example.com/old.pdf",
    });

  const save_bank = (next: string, opts?: IUpdateActionOpts) =>
    settle(
      update_action(
        next,
        opts
      )({
        request: new Request(`http://localhost/register/${RID}/4`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            update_type: "banking",
            o_bank_id: "999",
            o_bank_statement: OWN_DOC,
          }),
        }),
        params: { reg_id: RID },
        context: {} as any,
      } as any)
    );

  test("sends a save on a finished application to the summary", async () => {
    await seed_banking("111");

    const res = await save_bank("4");

    expect(res.headers.get("location")).toBe("../5");
    expect(res.headers.has("X-Remix-Replace")).toBe(false);
    expect((await reg_get(RID))?.o_bank_id).toBe("999");
  });

  // a fetcher's redirect pushes a history entry unless the response says
  // replace, and back onto the same step reads as a back press doing nothing
  test.each([
    ["a first save", null],
    ["a change of a saved bank", "111"],
  ])("`next_always` sends %s to `next` in place", async (_, o_bank_id) => {
    await seed_banking(o_bank_id);

    const res = await save_bank("4", { next_always: true });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("../4");
    expect(res.headers.get("X-Remix-Replace")).toBe("true");
    expect((await reg_get(RID))?.o_bank_id).toBe("999");
  });
});

describe("update_action — document urls", () => {
  const seed_docs = () =>
    test_db.current!.db.insert(registrations).values({
      id: RID,
      r_id: EMAIL,
      status: "01",
      o_bank_id: "111",
      o_bank_statement: "https://example.com/old.pdf",
      r_proof_of_identity: "https://example.com/id.pdf",
    });

  const save = (body: object) =>
    settle(
      update_action("4")({
        request: new Request(`http://localhost/register/${RID}/4`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        params: { reg_id: RID },
        context: {} as any,
      } as any)
    );

  test.each([
    [
      "the bank statement",
      {
        update_type: "banking",
        o_bank_id: "999",
        o_bank_statement: OTHERS_DOC,
      },
    ],
    [
      "a proof of identity",
      { update_type: "fsa-doc", r_proof_of_identity: OTHERS_DOC },
    ],
  ])(
    "refuses %s from another user's uploads, writing nothing",
    async (_, body) => {
      await seed_docs();

      const res = await save(body);

      expect(res.status).toBe(400);
      const row = await reg_get(RID);
      expect(row?.o_bank_id).toBe("111");
      expect(row?.o_bank_statement).toBe("https://example.com/old.pdf");
      expect(row?.r_proof_of_identity).toBe("https://example.com/id.pdf");
    }
  );

  test("keeps a stored url posted back unchanged, from before documents went private", async () => {
    await seed_docs();

    const res = await save({
      update_type: "banking",
      o_bank_id: "999",
      o_bank_statement: "https://example.com/old.pdf",
    });

    expect(res.status).toBe(302);
    expect((await reg_get(RID))?.o_bank_id).toBe("999");
  });

  test("takes the writer's own upload", async () => {
    await seed_docs();

    const res = await save({
      update_type: "fsa-doc",
      r_proof_of_identity: OWN_DOC,
    });

    expect(res.status).toBe(302);
    expect((await reg_get(RID))?.r_proof_of_identity).toBe(OWN_DOC);
  });
});
