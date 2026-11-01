import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { IFsaDocs, TStatus } from "@/reg/schema";
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

// the packet is anvil's, minted in the registrant's name: minting one is the
// harm, so every test reads whether it was asked for.
vi.mock("#/.server/registration/gen-fsa-signing-url", () => ({
  gen_fsa_signing_url: vi.fn(async () => ({
    url: "https://anvil.test/sign",
    doc_eid: "doc-1",
  })),
}));

vi.mock("#/.server/registration/helpers", () => ({
  reg_id_from_signer_eid: vi.fn(),
}));

import { get_session } from "#/.server/auth";
import { gen_fsa_signing_url } from "#/.server/registration/gen-fsa-signing-url";
import { reg_id_from_signer_eid } from "#/.server/registration/helpers";
import { enqueue } from "$/kit/queue";
import { reg_get } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action } from "./fsa-action";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";

/** org type answered — what `Progress.org_type` reads as ready to sign */
const READY = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
  o_website: "https://example.org",
  o_hq_country: "Philippines",
  o_designation: "Charity",
  o_type: "other",
  o_registration_number: "before",
} as const;

const DOCS: IFsaDocs = {
  o_registration_number: "after",
  o_legal_entity_type: "Nonprofit Corporation",
  o_project_description: "Providing humanitarian aid globally",
  o_proof_of_reg: "https://example.com/registration.pdf",
  r_proof_of_identity: "https://example.com/passport.pdf",
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
  vi.mocked(enqueue).mockClear();
  vi.mocked(gen_fsa_signing_url).mockClear();
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

const SEEN_AT = "2026-09-01T00:00:00.000Z";

const seed = (status: TStatus | null, fields: Partial<typeof READY> = READY) =>
  test_db.current!.db.insert(registrations).values({
    id: RID,
    r_id: EMAIL,
    status,
    updated_at: SEEN_AT,
    ...fields,
  });

/** a thrown `Response` is the refusal; anything else is the action's answer */
const post_docs = () =>
  Promise.resolve(
    action({
      ...doc_args(
        new Request(`http://localhost/register/${RID}/3/fsa`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(DOCS),
        })
      ),
      params: { reg_id: RID },
      context: {} as any,
    } as any)
  ).then(
    (res) => res as Response,
    (thrown: unknown) => {
      if (thrown instanceof Response) return thrown;
      throw thrown;
    }
  );

describe("fsa action — documentation form", () => {
  test("refuses another user's application with 403 and writes nothing", async () => {
    await seed("01");
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u-2", email: "mallory@test.com", role: null } as any,
    });

    const res = await post_docs();

    expect(res.status).toBe(403);
    expect(gen_fsa_signing_url).not.toHaveBeenCalled();
    const row = await reg_get(RID);
    expect(row?.o_registration_number).toBe("before");
    expect(row?.o_fsa_signing_url).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  // a step 3 tab left open past submit or approval: the draft status the
  // packet writes would pull the row out of review.
  test("an admin mints the packet in the registrant's name", async () => {
    await seed("01");
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u-9", email: "ops@test.com", role: "admin" } as any,
    });

    const res = await post_docs();

    expect(res.headers.get("location")).toBe("https://anvil.test/sign");
    expect(vi.mocked(gen_fsa_signing_url).mock.calls[0][1]).toMatchObject({
      email: EMAIL,
      first_name: "Jane",
      docs: DOCS,
    });
    expect(await reg_get(RID)).toMatchObject({
      o_registration_number: "after",
      o_fsa_signing_url: "https://anvil.test/sign",
    });
  });

  test.each<[TStatus, string]>([
    ["02", `/register/${RID}/5`],
    ["03", "/register/success"],
  ])("sends a %s application to %s with no packet", async (status, path) => {
    await seed(status);

    const res = await post_docs();

    expect(res.status).toBe(302);
    expect(
      new URL(res.headers.get("location")!, "http://localhost").pathname
    ).toBe(path);
    expect(gen_fsa_signing_url).not.toHaveBeenCalled();
    const row = await reg_get(RID);
    expect(row?.status).toBe(status);
    expect(row?.o_registration_number).toBe("before");
    expect(enqueue).not.toHaveBeenCalled();
  });

  // nothing may move a rejected row to draft but a recorded packet: step 5
  // would offer Submit over a reason the applicant never addressed.
  test("a request refused before anvil leaves a rejected row as it was", async () => {
    const { o_type: _, ...untyped } = READY;
    await seed("04", untyped);

    const res = await post_docs();

    expect(res.status).toBe(400);
    expect(gen_fsa_signing_url).not.toHaveBeenCalled();
    expect(await reg_get(RID)).toMatchObject({
      status: "04",
      updated_at: SEEN_AT,
    });
  });

  test("an anvil failure leaves a rejected row as it was", async () => {
    await seed("04");
    vi.mocked(gen_fsa_signing_url).mockRejectedValueOnce(new Error("anvil"));

    await expect(post_docs()).rejects.toThrow("anvil");

    expect(await reg_get(RID)).toMatchObject({
      status: "04",
      updated_at: SEEN_AT,
      o_registration_number: "before",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // a second tab submits while anvil is minting: the packet write is the
  // compare-and-set that catches it.
  test("drops a packet for a row submitted while it was minted", async () => {
    await seed("01");
    vi.mocked(gen_fsa_signing_url).mockImplementationOnce(async () => {
      await test_db
        .current!.db.update(registrations)
        .set({ status: "02", updated_at: new Date().toISOString() });
      return { url: "https://anvil.test/sign", doc_eid: "doc-1" };
    });

    const res = await post_docs();

    expect(res.headers.get("location")).toBe(`/register/${RID}/5`);
    expect(await reg_get(RID)).toMatchObject({
      status: "02",
      o_fsa_signing_url: null,
      o_registration_number: "before",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each<TStatus>(["01", "04"])(
    "records the documents and the packet on a %s application",
    async (status) => {
      await seed(status);

      const res = await post_docs();

      expect(res.headers.get("location")).toBe("https://anvil.test/sign");
      const row = await reg_get(RID);
      expect(row).toMatchObject({
        status: "01",
        o_registration_number: "after",
        o_fsa_signing_url: "https://anvil.test/sign",
        o_fsa_doc_eid: "doc-1",
      });
      expect(enqueue).toHaveBeenCalledOnce();
    }
  );
});

describe("fsa action — sign-result retry", () => {
  const post_eid = () =>
    Promise.resolve(
      action({
        ...doc_args(
          new Request(`http://localhost/register/${RID}/sign-result`, {
            method: "POST",
            body: new URLSearchParams({ signer_eid: "signer-1" }),
          })
        ),
        params: { reg_id: RID },
        context: {} as any,
      } as any)
    ).then(
      (res) => res as Response,
      (thrown: unknown) => {
        if (thrown instanceof Response) return thrown;
        throw thrown;
      }
    );

  // the eid names the application, not the url: owning a different one
  // must not reach it.
  test("refuses another user's signer with 403 and mints nothing", async () => {
    await seed("01");
    vi.mocked(reg_id_from_signer_eid).mockResolvedValue(RID);
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u-2", email: "mallory@test.com", role: null } as any,
    });

    const res = await post_eid();

    expect(res.status).toBe(403);
    expect(gen_fsa_signing_url).not.toHaveBeenCalled();
  });

  // a packet expired unsigned: reissued from the documents already on the
  // row, which the retry has no copy of and so must leave as they are.
  test("reissues the owner's packet over the documents on the row", async () => {
    await seed("01", {
      ...READY,
      ...DOCS,
      o_fsa_signing_url: "https://anvil.test/expired",
      o_fsa_doc_eid: "doc-0",
    } as Partial<typeof READY>);
    vi.mocked(reg_id_from_signer_eid).mockResolvedValue(RID);

    const res = await post_eid();

    expect(res.headers.get("location")).toBe("https://anvil.test/sign");
    expect(vi.mocked(gen_fsa_signing_url).mock.calls[0][1]).toMatchObject({
      email: EMAIL,
      docs: {
        o_registration_number: "after",
        o_proof_of_reg: DOCS.o_proof_of_reg,
      },
    });
    expect(await reg_get(RID)).toMatchObject({
      status: "01",
      ...DOCS,
      o_fsa_signing_url: "https://anvil.test/sign",
      o_fsa_doc_eid: "doc-1",
    });
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
