import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
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

const test_db = vi.hoisted(() => ({
  current: null as TestDb | null,
  before_update: () => {},
  before_transaction: async () => {},
}));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        if (prop === "update") test_db.before_update();
        if (prop === "transaction") {
          return async (...args: any[]) => {
            await test_db.before_transaction();
            return (real as any).transaction(...args);
          };
        }
        return (real as any)[prop];
      },
    }
  ),
}));

// the dedupe window stays real: it decides whether a repeat is announced
vi.mock("$/kit/queue", async (orig) => ({
  ...(await orig<typeof import("$/kit/queue")>()),
  enqueue: vi.fn(async () => {}),
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
import { DEDUPE_WINDOW_MS, enqueue } from "$/kit/queue";
import { reg_get } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { submit_action } from "./submit-action";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";

/** every step answered — what `Progress.banking` reads as ready to submit */
const COMPLETE = {
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
  o_bank_id: "999",
  o_bank_statement: "https://example.com/bank.pdf",
} as const;

const { o_bank_id: _, o_bank_statement: __, ...NO_BANK } = COMPLETE;
const STRIPE_ONLY = { ...NO_BANK, o_stripe_account_id: "acct_1" };

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  test_db.before_update = () => {};
  test_db.before_transaction = async () => {};
  routing.on = true;
  await test_db.current!.db.delete(registrations);
  vi.mocked(enqueue).mockClear();
  vi.mocked(get_session).mockResolvedValue({
    user: { id: "u-1", email: EMAIL, role: null } as any,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const seed = (
  status: TStatus,
  fields: Partial<typeof STRIPE_ONLY & typeof COMPLETE> = COMPLETE
) =>
  test_db.current!.db.insert(registrations).values({
    id: RID,
    r_id: EMAIL,
    status,
    status_rejected_reason: status === "04" ? "missing docs" : null,
    ...fields,
  });

/** a thrown `Response` is the refusal; anything else is the action's answer */
const submit = () =>
  Promise.resolve(
    submit_action({
      request: new Request(`http://localhost/register/${RID}/5`, {
        method: "POST",
      }),
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

/** the payload under remix-toast's `data()` wrapper */
const answer = (res: unknown) => (res as { data: unknown }).data;

describe("submit_action", () => {
  // an approved application sent back to review would leave the npo live while
  // the queue shows it pending. a stale tab is how it gets here, so the answer
  // is where the step loader sends an approved row, not an error page.
  test("sends an approved application to the success page, unchanged", async () => {
    await seed("03");
    await test_db
      .current!.db.update(registrations)
      .set({ status_approved_npo_id: 42 });

    const res = await submit();

    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!, "http://localhost");
    expect(to.pathname).toBe("/register/success");
    expect(to.searchParams.get("name")).toBe("Test Org");
    expect(to.searchParams.get("id")).toBe("42");
    expect((await reg_get(RID))?.status).toBe("03");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each<TStatus>(["01", "04"])(
    "sends a %s application to review",
    async (status) => {
      await seed(status);

      const res = await submit();

      expect(res).not.toBeInstanceOf(Response);
      const row = await reg_get(RID);
      expect(row?.status).toBe("02");
      expect(row?.status_rejected_reason).toBeNull();
      expect(enqueue).toHaveBeenCalledOnce();
    }
  );

  // the answer is what the step-5 page counts a signup on: a rejected
  // application sent back is the same nonprofit, not another one.
  test.each<[TStatus, boolean]>([
    ["01", true],
    ["04", false],
  ])("answers a %s submit as first: %s", async (status, first) => {
    await seed(status);

    const res = await submit();

    expect(answer(res)).toEqual({ first });
  });

  // both presses can read the draft before either writes; only the status check
  // in the write itself tells them apart.
  test("a double press submits once and answers both as submitted", async () => {
    await seed("01");
    // every write stamps its own millisecond, as two real presses do: a second
    // committed write would carry a second updated_at, so a second dedupe key
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-09-01") });
    test_db.before_update = () => vi.setSystemTime(Date.now() + 1);

    const answers = await Promise.all([submit(), submit()]);
    const statuses = answers.map((r) =>
      r instanceof Response ? r.status : "ok"
    );

    expect(statuses).toEqual(["ok", "ok"]);
    expect(answers.map(answer)).toEqual(
      expect.arrayContaining([{ first: true }, { first: false }])
    );
    expect((await reg_get(RID))?.status).toBe("02");
    // one write, so one dedupe key: qstash delivers the second as a no-op
    const keys = vi.mocked(enqueue).mock.calls.map(([m]) => m.dedupe);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test("refuses another user's submit with 403 and leaves it a draft", async () => {
    await seed("01");
    vi.mocked(get_session).mockResolvedValue({
      user: { id: "u-2", email: "mallory@test.com", role: null } as any,
    });

    const res = await submit();

    expect(res.status).toBe(403);
    expect((await reg_get(RID))?.status).toBe("01");
    expect(enqueue).not.toHaveBeenCalled();
  });

  // the status move commits before the enqueue; a publish that throws leaves an
  // application in review that admins were never told about.
  test("a retry after the enqueue threw succeeds and enqueues", async () => {
    await seed("01");
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("qstash down"));
    await expect(submit()).rejects.toThrow("qstash down");

    const res = await submit();

    expect(res).not.toBeInstanceOf(Response);
    expect(vi.mocked(enqueue).mock.calls[1]![0]).toMatchObject({
      id: "reg-updated",
      payload: { id: RID, status: "02" },
    });
  });

  // a second tab on step 5 pressed long after: qstash would send its message
  // again, filing a second hubspot deal.
  test("a repeat after the dedupe window succeeds and enqueues nothing", async () => {
    await seed("02");
    await test_db.current!.db.update(registrations).set({
      updated_at: new Date(Date.now() - DEDUPE_WINDOW_MS - 1000).toISOString(),
    });

    const res = await submit();

    expect(res).not.toBeInstanceOf(Response);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("refuses an incomplete application with 400", async () => {
    await seed("01", { r_first_name: "Jane" });

    const res = await submit();

    expect(res.status).toBe(400);
    expect((await reg_get(RID))?.status).toBe("01");
  });

  test("sends a stripe-only application to review", async () => {
    await seed("01", STRIPE_ONLY);

    const res = await submit();

    expect(res).not.toBeInstanceOf(Response);
    expect((await reg_get(RID))?.status).toBe("02");
  });

  test("refuses an application with neither a bank nor stripe", async () => {
    await seed("01", NO_BANK);

    const res = await submit();

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      "You need a bank account or a Stripe account to get paid. Add one to submit."
    );
    expect((await reg_get(RID))?.status).toBe("01");
  });

  // fiscally sponsored: stripe can never pay it, so the bank is how it is paid
  test("refuses a stripe-only application stripe can't serve, asking for a bank", async () => {
    await seed("01", {
      ...STRIPE_ONLY,
      o_type: "other" as any,
      o_ein: undefined,
      o_registration_number: "abc123",
      r_proof_of_identity: "https://example.com/id.pdf",
      o_proof_of_reg: "https://example.com/reg.pdf",
      o_project_description: "aid work",
      o_legal_entity_type: "Nonprofit Corporation",
      o_fsa_signing_url: "https://anvil.test/sign",
      o_fsa_signed_doc_url: "https://example.com/signed.pdf",
    } as any);

    const res = await submit();

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      "Stripe isn't available to this nonprofit, so it needs a bank account. Add one to submit."
    );
    expect((await reg_get(RID))?.status).toBe("01");
  });

  test("refuses a stripe-only application while routing is off, asking for a bank", async () => {
    routing.on = false;
    await seed("01", STRIPE_ONLY);

    const res = await submit();

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      "We aren't paying out through Stripe right now, so you need a bank account to get paid. Add one to submit."
    );
    expect((await reg_get(RID))?.status).toBe("01");
  });
});

describe("submit_action, resubmitting with a stripe account", () => {
  const OTHER = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const claim_by_other = () =>
    test_db.current!.db.insert(registrations).values({
      id: OTHER,
      r_id: "other@test.com",
      status: "01",
      o_stripe_account_id: STRIPE_ONLY.o_stripe_account_id,
    });

  // a claim elsewhere skips a rejected holder, so only the resubmit can see it
  test("refuses a rejected application whose account another one now holds", async () => {
    await seed("04", STRIPE_ONLY);
    await claim_by_other();

    const res = await submit();

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      "This Stripe account is now connected elsewhere on Better Giving. Connect a different account or add a bank account, then submit again."
    );
    expect((await reg_get(RID))?.status).toBe("04");
    expect(enqueue).not.toHaveBeenCalled();
  });

  // the claim's release lands between the read and the write
  test("refuses a resubmit whose account was released before the write", async () => {
    await seed("04", STRIPE_ONLY);
    test_db.before_transaction = async () => {
      await claim_by_other();
      await test_db
        .current!.db.update(registrations)
        .set({ o_stripe_account_id: null })
        .where(eq(registrations.id, RID));
    };

    const res = await submit();

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      "This Stripe account is now connected elsewhere on Better Giving. Connect a different account or add a bank account, then submit again."
    );
    expect((await reg_get(RID))?.status).toBe("04");
  });

  // a disconnect clears the account with no new holder
  test("refuses a resubmit whose account was dropped before the write", async () => {
    await seed("04", STRIPE_ONLY);
    test_db.before_transaction = async () => {
      await test_db
        .current!.db.update(registrations)
        .set({ o_stripe_account_id: null })
        .where(eq(registrations.id, RID));
    };

    const res = await submit();

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      "Your banking details changed while you were submitting. Check them and submit again."
    );
    expect((await reg_get(RID))?.status).toBe("04");
  });

  test("resubmits a rejected application that still holds its account alone", async () => {
    await seed("04", STRIPE_ONLY);

    const res = await submit();

    expect(answer(res)).toEqual({ first: false });
    expect((await reg_get(RID))?.status).toBe("02");
  });
});
