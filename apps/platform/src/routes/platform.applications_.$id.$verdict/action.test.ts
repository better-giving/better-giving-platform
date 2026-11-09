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
import type { IMsg } from "@/queue/types";
import { user } from "$/pg/schema/auth";
import { banking_apps } from "$/pg/schema/banking";
import { npos } from "$/pg/schema/npo";
import { registrations } from "$/pg/schema/registration";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({
  current: null as TestDb | null,
  before_update: () => {},
}));
const enqueued = vi.hoisted(() => [] as IMsg[]);
const send_email = vi.hoisted(() =>
  vi.fn(async (_: { subject: string; to: string[] }) => ({ data: null }))
);

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        if (prop === "update") test_db.before_update();
        return (real as any)[prop];
      },
    }
  ),
}));

// the dedupe window stays real: it decides whether a repeat is announced
vi.mock("$/kit/queue", async (orig) => ({
  ...(await orig<typeof import("$/kit/queue")>()),
  enqueue: vi.fn(async (...msgs: IMsg[]) => {
    enqueued.push(...msgs);
  }),
}));

vi.mock("$/kit/wise", () => ({
  wise: {
    v2_account: vi.fn(async () => ({
      longAccountSummary: "Test Bank ***1234",
      accountNumber: "***1234",
      name: { fullName: "Test Bank" },
      address: { city: "Austin", country: "US" },
      details: { abartn: "111000025" },
    })),
  },
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

// the delivery half: the handler the approval's payload lands in, with its
// outbound calls stubbed so only its branching is exercised.
vi.mock("$/email", () => ({
  send_email,
  send_email_or_throw: vi.fn(),
  sender: "test <test@test.com>",
}));
vi.mock("$/kit/slack", () => ({
  bg_sales: { send_alert: vi.fn(async () => ({ status: 200 })) },
}));
vi.mock("#/routes/api.q-handler.$event/handle-reg/hubspot", () => ({
  create_deal: vi.fn(async () => ({})),
  update_or_create_company: vi.fn(async () => ({ id: "c-1" })),
  update_or_create_contact: vi.fn(async () => ({ id: "p-1" })),
}));
vi.mock("#/.server/auth/auth", () => ({ auth: {} }));
const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));
const accounts = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("$/kit/stripe", () => ({ stripe: { accounts } }));

import type { ReactNode } from "react";
import { render } from "react-email";
import Stripe from "stripe";
import { handle_reg_updated } from "#/routes/api.q-handler.$event/handle-reg";
import { DEDUPE_WINDOW_MS, enqueue } from "$/kit/queue";
import { wise } from "$/kit/wise";
import { reg_get } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action } from "./route";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "jane@test.com";

/** every step answered and submitted */
const IN_REVIEW = {
  id: RID,
  r_id: EMAIL,
  status: "02",
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

/** an account stripe has heard nothing from yet */
const NOT_READY = {
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements: { currently_due: [] },
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  test_db.before_update = () => {};
  routing.on = true;
  const db = test_db.current!.db;
  await db.delete(user_npo_memberships);
  await db.delete(banking_apps);
  await db.delete(registrations);
  await db.delete(npos);
  await db.delete(user);
  enqueued.length = 0;
  send_email.mockClear();
  report_error.mockClear();
  vi.mocked(wise.v2_account).mockClear();
  accounts.retrieve.mockReset().mockResolvedValue(NOT_READY);

  await db.insert(user).values({
    id: "u-1",
    name: "Jane Doe",
    email: EMAIL,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Jane",
    last_name: "Doe",
  });
  await db.insert(registrations).values(IN_REVIEW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** a thrown `Response` is the refusal; anything else is the action's answer */
const verdict = (type: "approved" | "rejected", reason = "no") =>
  Promise.resolve(
    action({
      request: new Request(
        `http://localhost/platform/applications/${RID}/${type}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(type === "rejected" ? { reason } : {}),
        }
      ),
      params: { id: RID, verdict: type },
      context: {} as any,
    } as any)
  ).then(
    (res) => res as Response,
    (thrown: unknown) => {
      if (thrown instanceof Response) return thrown;
      throw thrown;
    }
  );

/** the verdict as if it committed before qstash's dedupe window */
const age_past_dedupe = () =>
  test_db.current!.db.update(registrations).set({
    updated_at: new Date(Date.now() - DEDUPE_WINDOW_MS - 1000).toISOString(),
  });

const reg_updates = () => enqueued.filter((m) => m.id === "reg-updated");
const dedupe_keys = (kind: string) =>
  new Set(enqueued.filter((m) => m.id === kind).map((m) => m.dedupe));

describe("approve", () => {
  test("enqueues the approved row, which mails the approval", async () => {
    const res = await verdict("approved");

    expect(res.status).toBe(302);
    const [m] = reg_updates();
    const npo_id = (await reg_get(RID))?.status_approved_npo_id;
    expect(m.payload).toMatchObject({
      id: RID,
      status: "03",
      status_approved_npo_id: npo_id,
    });

    await handle_reg_updated(m.payload as any);

    expect(send_email).toHaveBeenCalledOnce();
    expect(send_email.mock.calls[0][0]).toMatchObject({
      to: [EMAIL],
      subject: expect.stringMatching(/has been created/),
    });
  });

  // reg-updated is at-most-once: a transient wise error thrown ahead of the
  // mail would lose it for good.
  test("mails the approval when the bank lookup throws", async () => {
    await verdict("approved");
    const [m] = reg_updates();
    vi.mocked(wise.v2_account).mockRejectedValueOnce(new Error("wise 503"));

    await handle_reg_updated(m.payload as any);

    expect(send_email.mock.calls[0][0]).toMatchObject({
      to: [EMAIL],
      subject: expect.stringMatching(/has been created/),
    });
    expect(report_error).toHaveBeenCalledOnce();
  });

  // the transaction commits before the enqueue; a publish that throws leaves
  // an npo with no banking review and no approval mail.
  test("a retry after the enqueue threw succeeds and enqueues", async () => {
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("qstash down"));
    await expect(verdict("approved")).rejects.toThrow("qstash down");

    const res = await verdict("approved");

    expect(res.status).toBe(302);
    const npo_id = (await reg_get(RID))?.status_approved_npo_id;
    expect(enqueued.map((m) => [m.id, m.payload])).toEqual([
      ["banking-new", { npo_id }],
      ["reg-updated", expect.objectContaining({ id: RID, status: "03" })],
    ]);
    expect(await test_db.current!.db.select().from(npos)).toHaveLength(1);
  });

  test("copies the registration's stripe account onto the new npo", async () => {
    const db = test_db.current!.db;
    await db.update(registrations).set({ o_stripe_account_id: "acct_test123" });

    await verdict("approved");

    const [npo] = await db.select().from(npos);
    expect(npo).toMatchObject({
      stripe_account_id: "acct_test123",
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      stripe_requirements_due: [],
    });
  });

  test("a registration with no stripe account approves into an npo with none", async () => {
    await verdict("approved");

    const [npo] = await test_db.current!.db.select().from(npos);
    expect(npo?.stripe_account_id).toBeNull();
    expect(accounts.retrieve).not.toHaveBeenCalled();
  });

  describe("a stripe-only registration", () => {
    const stripe_only = () =>
      test_db.current!.db.update(registrations).set({
        o_bank_id: null,
        o_bank_statement: null,
        o_stripe_account_id: "acct_only",
      });

    test("approves into an npo with no bank, without asking wise", async () => {
      await stripe_only();

      const res = await verdict("approved");

      expect(res.status).toBe(302);
      const db = test_db.current!.db;
      const [npo] = await db.select().from(npos);
      expect(npo?.stripe_account_id).toBe("acct_only");
      expect(await db.select().from(banking_apps)).toEqual([]);
      expect(wise.v2_account).not.toHaveBeenCalled();
      expect(enqueued.map((m) => m.id)).toEqual(["reg-updated"]);
      expect((await reg_get(RID))?.status_approved_npo_id).toBe(npo?.id);
    });

    test("reads the account's readiness from stripe onto the new npo", async () => {
      await stripe_only();
      accounts.retrieve.mockResolvedValue({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [] },
      });

      await verdict("approved");

      expect(accounts.retrieve).toHaveBeenCalledWith("acct_only");
      const [npo] = await test_db.current!.db.select().from(npos);
      expect(npo).toMatchObject({
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
        stripe_synced_at: expect.any(String),
      });
    });

    test("approves when stripe can't be read, leaving the mirror for later", async () => {
      await stripe_only();
      const down = new Stripe.errors.StripeAPIError({ message: "stripe down" });
      accounts.retrieve.mockRejectedValue(down);

      const res = await verdict("approved");

      expect(res.status).toBe(302);
      expect((await reg_get(RID))?.status).toBe("03");
      expect(reg_updates()).toHaveLength(1);
      const [npo] = await test_db.current!.db.select().from(npos);
      expect(npo?.stripe_synced_at).toBeNull();
      expect(report_error).toHaveBeenCalledWith(down);
    });

    describe("whose account was disconnected in review", () => {
      // what `reg_stripe_deauthorize` leaves on a review row
      const disconnected = async () => {
        await stripe_only();
        await test_db.current!.db.update(registrations).set({
          o_stripe_account_id: null,
        });
      };

      test("refuses approval, saying why", async () => {
        await disconnected();

        const res = await verdict("approved");

        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/stripe account was disconnected/i);
        expect((await reg_get(RID))?.status).toBe("02");
        expect(await test_db.current!.db.select().from(npos)).toEqual([]);
      });

      test("is rejected, and the applicant mailed", async () => {
        await disconnected();

        const res = await verdict("rejected", "stripe disconnected");

        expect(res.status).toBe(302);
        expect((await reg_get(RID))?.status).toBe("04");
        expect(reg_updates()).toHaveLength(1);
      });
    });

    test("is refused while routing is off", async () => {
      routing.on = false;
      await stripe_only();

      const res = await verdict("approved");

      expect(res.status).toBe(400);
      expect((await reg_get(RID))?.status).toBe("02");
      expect(await test_db.current!.db.select().from(npos)).toEqual([]);
    });

    test("is rejected while routing is off", async () => {
      routing.on = false;
      await stripe_only();

      const res = await verdict("rejected", "docs incomplete");

      expect(res.status).toBe(302);
      expect((await reg_get(RID))?.status).toBe("04");
      expect(reg_updates()).toHaveLength(1);
    });

    test("approved, is announced again after routing goes off", async () => {
      await stripe_only();
      await verdict("approved");
      enqueued.length = 0;
      routing.on = false;

      const res = await verdict("approved");

      expect(res.status).toBe(302);
      expect(reg_updates()).toHaveLength(1);
    });
  });

  // a stale prompt pressed long after: the same keys would mail again
  test("a repeat after the dedupe window succeeds and enqueues nothing", async () => {
    await verdict("approved");
    await age_past_dedupe();
    enqueued.length = 0;

    const res = await verdict("approved");

    expect(res.status).toBe(302);
    expect(enqueued).toHaveLength(0);
  });

  // a verdict the row does not carry is a conflict, not a retry
  test("refuses to approve a rejected application with 409", async () => {
    await verdict("rejected");
    enqueued.length = 0;

    const res = await verdict("approved");

    expect(res.status).toBe(409);
    expect(wise.v2_account).not.toHaveBeenCalled();
    expect(await test_db.current!.db.select().from(npos)).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  test("a bank account already filed by another nonprofit creates no npo", async () => {
    const db = test_db.current!.db;
    const [other] = await db
      .insert(npos)
      .values({
        registration_number: "EIN-OTHER",
        name: "Other",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    await db
      .insert(banking_apps)
      .values({ id: IN_REVIEW.o_bank_id, npo_id: other!.id });

    const res = (await verdict("approved").catch((e) => e)) as Response;
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/already registered/);

    expect(await db.select().from(npos)).toHaveLength(1);
    expect((await reg_get(RID))?.status).toBe("02");
  });

  describe("a stripe account held elsewhere", () => {
    const ACCT = "acct_dup";
    const other_npo = () =>
      test_db
        .current!.db.insert(npos)
        .values({
          registration_number: "EIN-OTHER",
          name: "Other",
          endow_designation: "Charity",
          overview_pt: "[]",
          hq_country: "United States",
          stripe_account_id: ACCT,
        })
        .returning();

    /** refused whole: nothing of the approval is written or announced */
    const refused = async (res: Response) => {
      const db = test_db.current!.db;
      expect(res.status).toBe(409);
      expect(await res.text()).toMatch(
        `stripe account ${ACCT} is already linked to another nonprofit`
      );
      expect((await reg_get(RID))?.status).toBe("02");
      expect(await db.select().from(npos)).toHaveLength(1);
      expect(await db.select().from(banking_apps)).toHaveLength(0);
      expect(await db.select().from(user_npo_memberships)).toHaveLength(0);
      expect(enqueued).toHaveLength(0);
    };

    beforeEach(async () => {
      await test_db
        .current!.db.update(registrations)
        .set({ o_stripe_account_id: ACCT });
    });

    // a duplicate no claim's lock stopped: written before claims took it
    test("by an npo refuses the approval with 409", async () => {
      await other_npo();

      await refused(await verdict("approved"));
    });

    // the npo commits between the route's read and the approval's transaction,
    // here during the bank lookup that sits between them
    test("by an npo that claimed it mid-approval refuses with 409", async () => {
      vi.mocked(wise.v2_account).mockImplementationOnce(async () => {
        await other_npo();
        return {
          longAccountSummary: "Test Bank ***1234",
        } as Awaited<ReturnType<typeof wise.v2_account>>;
      });

      await refused(await verdict("approved"));
    });

    // the pending one would hit the npo's unique key at its own approval
    test("by another pending registration refuses with 409", async () => {
      const db = test_db.current!.db;
      await db.insert(registrations).values({
        ...IN_REVIEW,
        id: crypto.randomUUID(),
        status: "01",
        o_stripe_account_id: ACCT,
      });

      const res = await verdict("approved");

      expect(res.status).toBe(409);
      expect((await reg_get(RID))?.status).toBe("02");
      expect(await db.select().from(npos)).toHaveLength(0);
    });

    // the second finds the first's npo holding the account: a repeat, not a
    // holder elsewhere
    test("two approvals at once with an account create one npo", async () => {
      const statuses = await Promise.all([
        verdict("approved"),
        verdict("approved"),
      ]).then((rs) => rs.map((r) => r.status));

      expect(statuses).toEqual([302, 302]);
      const all = await test_db.current!.db.select().from(npos);
      expect(all.map((n) => n.stripe_account_id)).toEqual([ACCT]);
      expect(dedupe_keys("reg-updated").size).toBe(1);
    });
  });

  // both pass the route's read of "02"; the claim at the top of the transaction
  // stops the loser before its npo insert, so there is nothing to roll back.
  test("two approvals at once create one npo", async () => {
    const statuses = await Promise.all([
      verdict("approved"),
      verdict("approved"),
    ]).then((rs) => rs.map((r) => r.status));

    expect(wise.v2_account).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual([302, 302]);
    expect(await test_db.current!.db.select().from(npos)).toHaveLength(1);
    expect(await test_db.current!.db.select().from(banking_apps)).toHaveLength(
      1
    );
    // the loser announces the winner's approval: qstash takes each once
    expect(dedupe_keys("banking-new").size).toBe(1);
    expect(dedupe_keys("reg-updated").size).toBe(1);
  });
});

describe("reject", () => {
  const STRIPE_LINE =
    "Your Stripe account is still connected to this application. If you're not reapplying, you can disconnect Better Giving from your Stripe dashboard.";
  // every rejected application is editable, so every applicant resubmits
  const RESUBMIT_LINE =
    "You can rectify these issues and resubmit this application. If you have any questions at all, just get in touch at";
  /** the rejection mail as the applicant reads it */
  const mailed_text = async () => {
    await handle_reg_updated(reg_updates()[0].payload as any);
    const { node } = send_email.mock.calls[0][0] as unknown as {
      node: ReactNode;
    };
    return (await render(node, { plainText: true })).replace(/\s+/g, " ");
  };

  test("tells an applicant whose stripe account stays connected how to disconnect it", async () => {
    await test_db
      .current!.db.update(registrations)
      .set({ o_stripe_account_id: "acct_kept" });

    await verdict("rejected", "docs incomplete");

    const text = await mailed_text();
    expect(text).toContain("docs incomplete");
    expect(text).toContain(STRIPE_LINE);
    expect(text).toContain(RESUBMIT_LINE);
    expect(text.match(/resubmit/gi)).toHaveLength(1);
    expect(text).not.toContain("new application");
  });

  test("says nothing of stripe to an applicant who never connected it", async () => {
    await verdict("rejected", "docs incomplete");

    const text = await mailed_text();
    expect(text).not.toMatch(/stripe/i);
    expect(text).toContain(RESUBMIT_LINE);
    expect(text).not.toContain("new application");
  });

  test("a retry after the enqueue threw succeeds and enqueues", async () => {
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("qstash down"));
    await expect(verdict("rejected")).rejects.toThrow("qstash down");

    const res = await verdict("rejected");

    expect(res.status).toBe(302);
    expect(reg_updates().map((m) => m.payload)).toEqual([
      expect.objectContaining({ id: RID, status: "04" }),
    ]);
    await handle_reg_updated(reg_updates()[0].payload as any);
    expect(send_email.mock.calls[0][0].to).toEqual([EMAIL]);
  });

  test("a repeat after the dedupe window succeeds and enqueues nothing", async () => {
    await verdict("rejected");
    await age_past_dedupe();
    enqueued.length = 0;

    const res = await verdict("rejected");

    expect(res.status).toBe(302);
    expect(enqueued).toHaveLength(0);
  });

  // the applicant would be told the first reason while the admin saw theirs
  // accepted
  test("refuses a re-rejection with another reason with 409", async () => {
    await verdict("rejected", "missing docs");
    enqueued.length = 0;

    const res = await verdict("rejected", "wrong country");

    expect(res.status).toBe(409);
    expect((await reg_get(RID))?.status_rejected_reason).toBe("missing docs");
    expect(enqueued).toHaveLength(0);
  });

  test("refuses to reject an approved application with 409", async () => {
    await verdict("approved");
    enqueued.length = 0;

    const res = await verdict("rejected");

    expect(res.status).toBe(409);
    expect((await reg_get(RID))?.status).toBe("03");
    expect(enqueued).toHaveLength(0);
  });

  test("two rejections at once are announced under one dedupe key", async () => {
    // every write stamps its own millisecond, as two real presses do: a second
    // committed write would carry a second updated_at, so a second key
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-09-01") });
    test_db.before_update = () => vi.setSystemTime(Date.now() + 1);

    const statuses = await Promise.all([
      verdict("rejected"),
      verdict("rejected"),
    ]).then((rs) => rs.map((r) => r.status));

    expect(statuses).toEqual([302, 302]);
    expect(reg_updates()[0].payload).toMatchObject({ status: "04" });
    expect(dedupe_keys("reg-updated").size).toBe(1);
  });
});
