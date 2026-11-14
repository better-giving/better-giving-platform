import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TestDb } from "../pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const sent_mail = vi.hoisted(() => [] as unknown[]);
const send_alert = vi.hoisted(() => vi.fn());
const locks = vi.hoisted(() => [] as string[]);
vi.mock("../pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

vi.mock("$/env", () => ({ base_url: "https://bg.test", stage: "test" }));
// the real lock, its key recorded: pglite is one connection, so a return
// racing the re-send can't be interleaved here
vi.mock("./owed-run", async (io) => {
  const real = await io<typeof import("./owed-run")>();
  return {
    ...real,
    lock_run: async (...args: Parameters<typeof real.lock_run>) => {
      locks.push(args[1]);
      return real.lock_run(...args);
    },
  };
});
vi.mock("$/pg/queries/user", () => ({
  npo_admins: async () => [{ email: "a@bg.test" }],
}));
vi.mock("$/kit/slack", () => ({ aws_monitor: { send_alert } }));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
// what the npo's payouts were when its admins were emailed
vi.mock("$/email", () => ({
  send_email_or_throw: vi.fn(async () => {
    sent_mail.push(await rows());
  }),
}));

const { npo_return_hold, resend_returned } = await import("./resend-returned");
const { handle_banking_approved, handle_banking_set_default } = await import(
  "#/routes/api.q-handler.$event/handle-banking"
);
const { bapp_approve, bapp_set_default } = await import(
  "../pg/queries/banking"
);
const { banking_apps } = await import("../pg/schema/banking");
const { npos } = await import("../pg/schema/npo");
const { npo_last_return } = await import("../pg/queries/payout");
const { payouts, settlements } = await import("../pg/schema/payout");
const { create_test_db } = await import("../pg/test-utils/pglite");

const db = () => test_db.current!.db;

/** the returned transfer went out before every approval below */
const SENT = "2026-11-01T00:00:00.000Z";

let npo_id: number;
let other_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const npo = (registration_number: string) => ({
  registration_number,
  name: registration_number,
  endow_designation: "Charity" as const,
  overview_pt: "[]",
  hq_country: "United States",
});

beforeEach(async () => {
  sent_mail.length = 0;
  locks.length = 0;
  send_alert.mockReset();
  await db().delete(payouts);
  await db().delete(settlements);
  await db().delete(npos);
  const [a, b] = await db()
    .insert(npos)
    .values([npo("EIN-RESEND"), npo("EIN-OTHER")])
    .returning();
  npo_id = a!.id;
  other_id = b!.id;
});

/** a payout of a run whose transfer came back, for `npo` */
async function seed_returned(id: string, npo = npo_id) {
  const sttl = `sttl-${npo}`;
  await db()
    .insert(settlements)
    .values({
      id: sttl,
      other_id: `ref-${npo}`,
      npo_id: npo,
      date: SENT,
      amount: 100,
      status: "returned",
    })
    .onConflictDoNothing();
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id: npo,
      source: "donation",
      date: "2026-10-01T00:00:00.000Z",
      amount: 100,
      type: "returned",
      settled_id: sttl,
      settled_date: SENT,
    });
}

async function seed_bapp(
  id: string,
  status: "default" | "approved" | "under-review",
  updated_at = "2026-06-01T00:00:00.000Z"
) {
  await db()
    .insert(banking_apps)
    .values({ id, npo_id, status, date_created: updated_at, updated_at });
}

const rows = async () =>
  Object.fromEntries(
    (await db().select().from(payouts)).map((p) => [
      p.id,
      [p.type, p.settled_id, p.settled_date],
    ])
  );

describe("resend_returned", () => {
  test("an npo's first approved account takes its returned payouts back to pending, with no settlement on them", async () => {
    await seed_returned("p-1");
    await seed_returned("p-2");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    const res = await resend_returned(npo_id);

    expect(res).toEqual({ status: "resent", ids: ["p-1", "p-2"] });
    expect(await rows()).toEqual({
      "p-1": ["pending", null, null],
      "p-2": ["pending", null, null],
    });
  });

  test("a second call resends nothing", async () => {
    await seed_returned("p-1");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);
    await resend_returned(npo_id);

    expect(await resend_returned(npo_id)).toEqual({ status: "none" });
    expect((await rows())["p-1"]?.[0]).toBe("pending");
  });

  test("only the npo's returned payouts move", async () => {
    await seed_returned("p-1");
    await seed_returned("p-other", other_id);
    await db()
      .insert(payouts)
      .values({
        id: "p-settled",
        source_id: "dist-settled",
        npo_id,
        source: "donation",
        date: "2026-10-01T00:00:00.000Z",
        amount: 5,
        type: "settled",
        settled_id: `sttl-${npo_id}`,
        settled_date: SENT,
      });
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    await resend_returned(npo_id);

    const r = await rows();
    expect([r["p-1"]?.[0], r["p-other"]?.[0], r["p-settled"]?.[0]]).toEqual([
      "pending",
      "returned",
      "settled",
    ]);
  });

  test("an account approved beside the default the transfer bounced from holds them, until it is made the default", async () => {
    await seed_returned("p-1");
    await seed_bapp("old", "default");
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    expect(await resend_returned(npo_id)).toEqual({
      status: "held",
      reason: "the default account predates the returned transfer",
    });
    expect((await rows())["p-1"]?.[0]).toBe("returned");

    await bapp_set_default("new", npo_id);

    expect(await resend_returned(npo_id)).toEqual({
      status: "resent",
      ids: ["p-1"],
    });
  });

  test("an account approved as the default demotes the one the transfer bounced from in the same write, and lifts the hold", async () => {
    await seed_returned("p-1");
    await seed_bapp("old", "default");
    await seed_bapp("new", "under-review");

    expect(await bapp_approve("new", npo_id, { as_default: true })).toEqual({
      id: "new",
      status: "under-review",
    });

    const bapps = await db()
      .select()
      .from(banking_apps)
      .where(eq(banking_apps.npo_id, npo_id));
    expect(
      Object.fromEntries(
        bapps.map((b) => [
          b.id,
          [b.status, new Date(b.updated_at) > new Date(SENT)],
        ])
      )
    ).toEqual({ old: ["approved", true], new: ["default", true] });
    expect(await resend_returned(npo_id)).toEqual({
      status: "resent",
      ids: ["p-1"],
    });
  });

  test("reads the hold and re-sends under the npo's run lock, the one a return takes", async () => {
    await seed_returned("p-1");
    await seed_bapp("new", "default", "2026-11-05T00:00:00.000Z");

    expect(await resend_returned(npo_id)).toEqual({
      status: "resent",
      ids: ["p-1"],
    });
    expect(locks).toEqual([`grant_run:npo:${npo_id}`]);
  });

  test("an npo with no account to pay keeps them returned", async () => {
    await seed_returned("p-1");
    await seed_bapp("new", "under-review");

    expect(await resend_returned(npo_id)).toEqual({
      status: "held",
      reason: "no approved account",
    });
  });
});

describe("npo_return_hold", () => {
  test("an npo whose transfers never came back is not held", async () => {
    await seed_bapp("old", "default");

    expect(await npo_return_hold(npo_id)).toBeNull();
  });

  test("refunding every returned payout leaves the npo held: the run would pay the account that bounced", async () => {
    await seed_returned("p-1");
    await seed_bapp("old", "default");
    await db().update(payouts).set({ type: "refunded" });

    expect(await npo_return_hold(npo_id)).toEqual({
      settlement_id: `sttl-${npo_id}`,
      status: "returned",
      amount: 100,
      date: SENT,
      reason: "the default account predates the returned transfer",
    });
  });

  test.each([
    ["a newer awaiting_repair one", "returned", "awaiting_repair"],
    ["a newer returned one", "awaiting_repair", "returned"],
  ] as const)(
    "npo_last_return picks the latest of two settlements in different states: %s",
    async (_, older, newer) => {
      const put = (id: string, status: string, date: string) =>
        db()
          .insert(settlements)
          .values({
            id,
            other_id: `ref-${id}`,
            npo_id,
            date,
            amount: 100,
            status,
          });
      await put("sttl-old", older, "2026-10-01T00:00:00.000Z");
      await put("sttl-new", newer, "2026-11-01T00:00:00.000Z");

      expect(await npo_last_return(npo_id)).toMatchObject({
        id: "sttl-new",
        status: newer,
      });
    }
  );

  test("a transfer awaiting repair holds the npo like a returned one, and a new default lifts it with nothing to re-send", async () => {
    await seed_bapp("old", "default");
    await db().insert(settlements).values({
      id: "sttl-repair",
      other_id: "ref-repair",
      npo_id,
      date: SENT,
      amount: 100,
      status: "awaiting_repair",
    });
    await db().insert(payouts).values({
      id: "p-loss",
      source_id: "dist-p-loss",
      npo_id,
      source: "donation",
      date: "2026-10-01T00:00:00.000Z",
      amount: 100,
      type: "refunded_loss",
    });

    expect(await npo_return_hold(npo_id)).toEqual({
      settlement_id: "sttl-repair",
      status: "awaiting_repair",
      amount: 100,
      date: SENT,
      reason: "the default account predates the returned transfer",
    });
    expect(await resend_returned(npo_id)).toMatchObject({ status: "held" });

    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id, { as_default: true });

    expect(await npo_return_hold(npo_id)).toBeNull();
    expect(await resend_returned(npo_id)).toEqual({ status: "none" });
    expect((await rows())["p-loss"]).toEqual(["refunded_loss", null, null]);
  });

  test("an account approved beside the old default leaves it held; made default, it lifts the hold and re-sends what is still returned", async () => {
    await seed_returned("p-1");
    await seed_returned("p-2");
    await seed_bapp("old", "default");
    await db()
      .update(payouts)
      .set({ type: "refunded" })
      .where(eq(payouts.id, "p-1"));
    await seed_bapp("new", "under-review");
    await bapp_approve("new", npo_id);

    expect(await npo_return_hold(npo_id)).not.toBeNull();

    await bapp_set_default("new", npo_id);

    expect(await npo_return_hold(npo_id)).toBeNull();
    expect(await resend_returned(npo_id)).toEqual({
      status: "resent",
      ids: ["p-2"],
    });
    expect(await rows()).toEqual({
      "p-1": ["refunded", `sttl-${npo_id}`, SENT],
      "p-2": ["pending", null, null],
    });
  });
});

describe.each([
  ["an approval", handle_banking_approved],
  ["a new default", handle_banking_set_default],
])("%s, handled off the queue", (_, handle) => {
  test("re-sends the npo's returned payouts before its admins are emailed, and tells ops", async () => {
    await seed_returned("p-1");
    await seed_returned("p-2");
    await seed_bapp("new", "default", "2026-11-05T00:00:00.000Z");

    await handle({ npo_id });

    expect(sent_mail).toEqual([
      { "p-1": ["pending", null, null], "p-2": ["pending", null, null] },
    ]);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Returned payouts re-sent for npo:${npo_id}`);
    expect(alert.fields).toContainEqual({
      name: "payout_ids",
      value: "p-1, p-2",
    });
  });

  test("tells ops when the npo's grants stay held", async () => {
    await seed_returned("p-1");
    await seed_bapp("old", "default");

    await handle({ npo_id });

    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Grants still held for npo:${npo_id}`);
    expect(alert.body).toMatch(/predates the returned transfer/);
    expect(sent_mail).toHaveLength(1);
  });

  test("an npo with nothing returned is only emailed", async () => {
    await seed_bapp("new", "default");

    await handle({ npo_id });

    expect(sent_mail).toHaveLength(1);
    expect(send_alert).not.toHaveBeenCalled();
  });
});
