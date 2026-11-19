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
import type { TestDb } from "../pg/test-utils/pglite";
import type { Pay } from "./settle";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());
const send_alert = vi.hoisted(() => vi.fn());
const deductions = vi.hoisted(() => ({ on: false }));
const verify_qstash = vi.hoisted(() => vi.fn());
const transfer_get = vi.hoisted(() => vi.fn());

vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("../env", () => ({
  stage: "test",
  get owed_deductions() {
    return deductions.on;
  },
}));
// before every gift here, so a row a run may net once its notice is sent
vi.mock("@/terms", async (io) => ({
  ...(await io<typeof import("@/terms")>()),
  TERMS_RECOVERY_FROM: "2026-01-01",
  TERMS_POSTED: "",
}));
vi.mock("../kit/queue", () => ({ verify_qstash }));
vi.mock("../kit/wise", () => ({ wise: { transfer_get } }));
vi.mock("../kit/slack", () => ({
  aws_monitor: { send_alert },
  fiat_monitor: { send_alert: vi.fn() },
}));
vi.mock("../pg/db", () => ({
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

const { poll_wise_returns, return_settlement } = await import("./wise-return");
const { settle_npo_payouts } = await import("./settle");
const { grant_state, ON_PATH } = await import("@/payouts/wise-path");
const { npo_return_hold, resend_returned } = await import("./resend-returned");
const {
  npo_bounced_payouts,
  npo_payouts,
  npo_settlements,
  processing_payouts,
} = await import("../pg/queries/payout");
const { dists } = await import("../pg/schema/dist");
const { bal_txs } = await import("../pg/schema/bal-tx");
const { donations } = await import("../pg/schema/donation");
const { loss_logs, rev_logs } = await import("../pg/schema/revenue");
const { owed_amounts } = await import("../pg/schema/owed");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { banking_apps } = await import("../pg/schema/banking");
const { npos } = await import("../pg/schema/npo");
const { payouts, settlements } = await import("../pg/schema/payout");

const db = () => test_db.current!.db;

const RECIPIENT = "777";
const NOW = "2026-11-12T12:00:00.000Z";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  report_error.mockReset();
  send_alert.mockReset();
  deductions.on = false;
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(NOW) });
  await db().delete(bal_txs);
  await db().delete(loss_logs);
  await db().delete(owed_amounts);
  await db().delete(rev_logs);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(settlements);
  await db().delete(banking_apps);
  await db().delete(npos);
});

afterEach(() => {
  vi.useRealTimers();
});

async function seed_npo(cash: number) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-DELIVERY",
      name: "Delivery Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash,
    })
    .returning();
  return { id: npo!.id, name: npo!.name, payout_minimum: 50 };
}

async function seed_payout(npo_id: number, id: string, amount: number) {
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-09-01T00:00:00.000Z",
      amount,
      type: "pending",
    });
}

let next_transfer = 4000;

/** a grants run that funds the npo's pending `ids` through wise */
async function funded(
  npo: Awaited<ReturnType<typeof seed_npo>>,
  ids: string[]
) {
  const transfer_id = ++next_transfer;
  const pay = vi.fn<Pay>(async () => transfer_id);
  const res = await settle_npo_payouts(npo, ids, { ref_key: RECIPIENT, pay });
  expect(res.status).toBe("settled");
  return String(transfer_id);
}

const payout_rows = async () =>
  Object.fromEntries(
    (await db().select().from(payouts)).map((r) => [
      r.id,
      { type: r.type, settled_id: r.settled_id, settled_date: r.settled_date },
    ])
  );

const types = async () =>
  Object.fromEntries(
    Object.entries(await payout_rows()).map(([id, r]) => [id, r.type])
  );

const status_of = async (id: string) =>
  (
    await db()
      .select({
        status: settlements.status,
        recipient: settlements.recipient_id,
      })
      .from(settlements)
      .where(eq(settlements.id, id))
  )[0];

const npo_cash = async (id: number) =>
  (await db().select({ cash: npos.cash }).from(npos).where(eq(npos.id, id)))[0]
    ?.cash;

const state =
  (status: string, recipient = RECIPIENT) =>
  async () => ({
    status,
    recipient,
  });

describe("a funded grants run is Sending until wise reports it sent", () => {
  test("funding leaves its payouts processing, owned by the run, and takes the cash", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);

    const transfer = await funded(npo, ["p-1", "p-2"]);

    expect(await payout_rows()).toEqual({
      "p-1": { type: "processing", settled_id: transfer, settled_date: null },
      "p-2": { type: "processing", settled_id: transfer, settled_date: null },
    });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(await processing_payouts()).toEqual([]);
  });

  test("a claim that was never funded still shows as a stuck claim", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    await db()
      .update(payouts)
      .set({ type: "processing", message: "ref-1" })
      .where(eq(payouts.id, "p-1"));

    expect((await processing_payouts()).map((p) => p.id)).toEqual(["p-1"]);
  });

  test.each(["incoming_payment_initiated", "processing", "funds_converted"])(
    "a transfer at %s keeps them processing",
    async (s) => {
      const npo = await seed_npo(500);
      await seed_payout(npo.id, "p-1", 100);
      const transfer = await funded(npo, ["p-1"]);

      await poll_wise_returns(state(s));

      expect((await status_of(transfer))?.status).toBe(s);
      expect(await types()).toEqual({ "p-1": "processing" });
      expect(send_alert).not.toHaveBeenCalled();
    }
  );

  test("outgoing_payment_sent settles them, dated when the poll saw it, once", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);

    await poll_wise_returns(state("outgoing_payment_sent"));
    vi.setSystemTime(Date.parse("2026-11-13T12:00:00.000Z"));
    await poll_wise_returns(state("outgoing_payment_sent"));

    expect(await payout_rows()).toEqual({
      "p-1": { type: "settled", settled_id: transfer, settled_date: NOW },
    });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(send_alert).not.toHaveBeenCalled();
  });
});

describe("a run is scoped by its own transfer", () => {
  test("delivering one run leaves another run's payouts processing", async () => {
    const npo = await seed_npo(1000);
    await seed_payout(npo.id, "p-1", 100);
    await seed_payout(npo.id, "p-2", 100);
    const first = await funded(npo, ["p-1"]);
    await funded(npo, ["p-2"]);

    await poll_wise_returns(async (id) =>
      String(id) === first ? "outgoing_payment_sent" : "processing"
    );

    expect(await types()).toEqual({ "p-1": "settled", "p-2": "processing" });
  });
});

const days_ago = (n: number) =>
  new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

describe("an open run is polled and held whatever its age; only a delivered one stops", () => {
  test("a bounced run at day 100 is still polled", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await poll_wise_returns(state("bounced_back"));
    await db()
      .update(settlements)
      .set({ date: days_ago(100) })
      .where(eq(settlements.id, transfer));
    const lookup = vi.fn(state("bounced_back"));

    await poll_wise_returns(lookup);

    expect(lookup).toHaveBeenCalledOnce();
  });

  test("a refund at day 120 is credited, and the npo is held until then", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await poll_wise_returns(state("bounced_back"));
    await db()
      .update(settlements)
      .set({ date: days_ago(120) })
      .where(eq(settlements.id, transfer));
    expect(await npo_return_hold(npo.id)).toMatchObject({ status: "bounced" });
    expect(await types()).toEqual({ "p-1": "bounced" });

    await poll_wise_returns(state("funds_refunded"));

    expect(await types()).toEqual({ "p-1": "returned" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(await npo_return_hold(npo.id)).toMatchObject({ status: "returned" });
  });

  test("a run still on its way at day 100 is polled, and delivery settles it", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await db()
      .update(settlements)
      .set({ date: days_ago(100) })
      .where(eq(settlements.id, transfer));

    await poll_wise_returns(state("outgoing_payment_sent"));

    expect((await payout_rows())["p-1"]?.type).toBe("settled");
  });

  test("a delivered run at day 100 is not polled", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await poll_wise_returns(state("outgoing_payment_sent"));
    await db()
      .update(settlements)
      .set({ date: days_ago(100) })
      .where(eq(settlements.id, transfer));
    const lookup = vi.fn(state("bounced_back"));

    await poll_wise_returns(lookup);

    expect(lookup).not.toHaveBeenCalled();
    expect(await types()).toEqual({ "p-1": "settled" });
  });
});

describe("history stored before delivery was tracked holds no one", () => {
  test.each(["settled", "cancelled"])(
    "a settlement stored %s whose payouts stayed settled does not hold the npo and is not polled",
    async (status) => {
      const npo = await seed_npo(0);
      await seed_payout(npo.id, "p-old", 100);
      await db()
        .insert(settlements)
        .values({
          id: "9001",
          other_id: "ref-9001",
          npo_id: npo.id,
          date: days_ago(200),
          amount: 100,
          status,
        });
      await db()
        .update(payouts)
        .set({ type: "settled", settled_id: "9001" })
        .where(eq(payouts.id, "p-old"));
      const lookup = vi.fn(state("bounced_back"));

      await poll_wise_returns(lookup);

      expect(lookup).not.toHaveBeenCalled();
      expect(await npo_return_hold(npo.id)).toBeNull();
    }
  );
});

describe("a cancelled transfer on its way to a refund", () => {
  const seed_cancelled = async (npo_id: number, age_days: number) => {
    await seed_payout(npo_id, "p-1", 100);
    await db()
      .insert(settlements)
      .values({
        id: "9003",
        other_id: "ref-9003",
        npo_id,
        date: days_ago(age_days),
        amount: 100,
        status: "cancelled",
      });
    await db()
      .update(payouts)
      .set({ type: "settled", settled_id: "9003" })
      .where(eq(payouts.id, "p-1"));
  };

  test("a cancelled run at day 10 that later reads funds_refunded is credited and taken back", async () => {
    const npo = await seed_npo(400);
    await seed_cancelled(npo.id, 10);

    await poll_wise_returns(state("funds_refunded"));

    expect(await types()).toEqual({ "p-1": "returned" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(await status_of("9003")).toMatchObject({ status: "returned" });
  });

  test("a cancelled run at day 200 is not polled, so its refund is not read", async () => {
    const npo = await seed_npo(400);
    await seed_cancelled(npo.id, 200);
    const lookup = vi.fn(state("funds_refunded"));

    await poll_wise_returns(lookup);

    expect(lookup).not.toHaveBeenCalled();
    expect(await npo_cash(npo.id)).toBe(400);
  });
});

describe("the pause survives a donor refund", () => {
  test.each(["bounced_back", "charged_back"])(
    "a %s run whose only bounced payout is refunded keeps the npo held, and nothing is re-sent",
    async (wise_state) => {
      const npo = await seed_npo(500);
      await seed_payout(npo.id, "p-1", 100);
      const transfer = await funded(npo, ["p-1"]);
      await poll_wise_returns(state(wise_state));
      expect(await npo_return_hold(npo.id)).toMatchObject({
        settlement_id: transfer,
      });

      // a donor refund finding the grant gone: the payout is `refunded_loss`
      await db()
        .update(payouts)
        .set({ type: "refunded_loss" })
        .where(eq(payouts.id, "p-1"));

      expect(await npo_return_hold(npo.id)).toMatchObject({
        settlement_id: transfer,
        status: "bounced",
        wise_state,
      });
      expect(await resend_returned(npo.id)).toEqual({
        status: "held",
        reason: expect.any(String),
      });
      expect(await types()).toEqual({ "p-1": "refunded_loss" });
    }
  );

  test("a returned run with a refunded payout holds no one beyond today's returned rule", async () => {
    const npo = await seed_npo(0);
    await seed_payout(npo.id, "p-r", 100);
    await db()
      .insert(settlements)
      .values({
        id: "9005",
        other_id: "ref-9005",
        npo_id: npo.id,
        date: days_ago(5),
        amount: 100,
        status: "returned",
        recipient_id: "bank-x",
      });
    await db()
      .update(payouts)
      .set({ type: "refunded_loss", settled_id: "9005" })
      .where(eq(payouts.id, "p-r"));
    // the returned rule holds: nothing is added or lifted
    expect(await npo_return_hold(npo.id)).toMatchObject({
      settlement_id: "9005",
      status: "returned",
    });
  });

  test.each(["cancelled", "some_new_state"])(
    "a %s run whose only bounced payout is refunded keeps the npo held, and nothing is re-sent",
    async (wise_state) => {
      const npo = await seed_npo(500);
      await seed_payout(npo.id, "p-1", 100);
      const transfer = await funded(npo, ["p-1"]);
      await poll_wise_returns(state(wise_state));
      expect(await types()).toEqual({ "p-1": "bounced" });

      await db()
        .update(payouts)
        .set({ type: "refunded_loss" })
        .where(eq(payouts.id, "p-1"));

      expect(await npo_return_hold(npo.id)).toMatchObject({
        settlement_id: transfer,
        status: "bounced",
        wise_state,
      });
      expect(await resend_returned(npo.id)).toMatchObject({ status: "held" });
      expect(await types()).toEqual({ "p-1": "refunded_loss" });
    }
  );

  test("an awaiting-repair run with a refunded payout holds exactly as before", async () => {
    const npo = await seed_npo(0);
    await seed_payout(npo.id, "p-a", 100);
    await db()
      .insert(settlements)
      .values({
        id: "9007",
        other_id: "ref-9007",
        npo_id: npo.id,
        date: days_ago(5),
        amount: 100,
        status: "awaiting_repair",
        recipient_id: "bank-x",
      });
    await db()
      .update(payouts)
      .set({ type: "refunded_loss", settled_id: "9007" })
      .where(eq(payouts.id, "p-a"));

    expect(await npo_return_hold(npo.id)).toMatchObject({
      settlement_id: "9007",
      status: "awaiting_repair",
    });
  });

  test.each([...ON_PATH, "outgoing_payment_sent", "settled"])(
    "a run stored %j with a refunded payout holds no one",
    async (status) => {
      const npo = await seed_npo(0);
      await seed_payout(npo.id, "p-d", 10);
      await db()
        .insert(settlements)
        .values({
          id: "9200",
          other_id: "ref-9200",
          npo_id: npo.id,
          date: days_ago(5),
          amount: 10,
          status,
        });
      await db()
        .update(payouts)
        .set({ type: "refunded_loss", settled_id: "9200" })
        .where(eq(payouts.id, "p-d"));

      expect(await npo_return_hold(npo.id)).toBeNull();
    }
  );

  test("a cancelled run at day 120 with a refunded payout is still polled and still holds", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await poll_wise_returns(state("cancelled"));
    await db()
      .update(payouts)
      .set({ type: "refunded_loss" })
      .where(eq(payouts.id, "p-1"));
    await db()
      .update(settlements)
      .set({ date: days_ago(120) })
      .where(eq(settlements.id, transfer));
    const lookup = vi.fn(state("cancelled"));

    await poll_wise_returns(lookup);

    expect(lookup).toHaveBeenCalledOnce();
    expect(await npo_return_hold(npo.id)).not.toBeNull();
  });
});

describe("the payouts list carries the charged-back flag", () => {
  test("a bounced payout rides its transfer's stored state; a plain bounce has no flag", async () => {
    const npo = await seed_npo(1000);
    await seed_payout(npo.id, "p-c", 100);
    await seed_payout(npo.id, "p-b", 100);
    await funded(npo, ["p-c"]);
    await funded(npo, ["p-b"]);
    await poll_wise_returns(state("bounced_back"));
    await db()
      .update(settlements)
      .set({ status: "charged_back" })
      .where(
        eq(
          settlements.id,
          (await db().select().from(payouts).where(eq(payouts.id, "p-c")))[0]!
            .settled_id!
        )
      );

    const { items } = await npo_payouts(npo.id, {});
    const by_id = Object.fromEntries(items.map((i) => [i.id, i]));

    expect(by_id["p-c"]).toMatchObject({ type: "bounced", charged_back: true });
    expect(by_id["p-b"]).toMatchObject({ type: "bounced" });
    expect(by_id["p-b"]).not.toHaveProperty("charged_back");
  });
});

describe("a cancelled run that holds is flagged on the grants list", () => {
  test("still flagged bounced after a donor refund took its payout", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await poll_wise_returns(state("cancelled"));
    await db()
      .update(payouts)
      .set({ type: "refunded_loss" })
      .where(eq(payouts.id, "p-1"));

    const { items } = await npo_settlements(npo.id, {});

    expect(items.find((i) => i.id === transfer)?.bounced).toBe(true);
  });
});

describe("what the notices count as coming back", () => {
  test("a charged-back run's payouts are left out of the bounced count and total", async () => {
    const npo = await seed_npo(1000);
    await seed_payout(npo.id, "p-c", 481.5);
    await seed_payout(npo.id, "p-b", 100);
    const charged = await funded(npo, ["p-c"]);
    await funded(npo, ["p-b"]);
    await poll_wise_returns(state("bounced_back"));
    await db()
      .update(settlements)
      .set({ status: "charged_back" })
      .where(eq(settlements.id, charged));

    expect(await npo_bounced_payouts(npo.id)).toMatchObject({
      count: 1,
      total: 100,
    });
  });

  test("with only charged-back payouts there is nothing coming back", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-c", 100);
    await funded(npo, ["p-c"]);
    await poll_wise_returns(state("charged_back"));

    expect(await npo_bounced_payouts(npo.id)).toBeNull();
  });
});

describe("a charged-back transfer", () => {
  test("is final: its payouts stay Bounced, nothing is credited, the npo stays held, and ops is told to resolve it by hand", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);

    await poll_wise_returns(state("charged_back"));
    const lookup = vi.fn(state("funds_refunded"));
    await poll_wise_returns(lookup);

    expect(lookup).not.toHaveBeenCalled();
    expect(await types()).toEqual({ "p-1": "bounced" });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(await npo_return_hold(npo.id)).toMatchObject({
      settlement_id: transfer,
      status: "bounced",
    });
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Wise transfer charged_back: npo:${npo.id}`);
    expect(alert.body).toMatch(/charged back/);
    expect(alert.body).toMatch(/nothing was credited or re-sent/);
    expect(alert.body).toMatch(/resolve it by hand/);
    expect(alert.body).not.toMatch(/hold lifts when Wise delivers/);
    expect(alert.body).toMatch(
      /do not cancel, settle or return these payouts until the npo has a different bank account approved/
    );
    expect(alert.body).toMatch(
      /ends the hold, so the next grants run pays the npo's other pending payouts to the account that was charged back/
    );
    expect(alert.body).toContain(
      "do not move the payouts to returned: that would also re-send them there."
    );
    // said once
    expect(alert.body.match(/move the payouts to returned/g)).toHaveLength(1);
    expect(alert.body).toMatch(/once the new account is approved/);
    expect(alert.body).not.toMatch(/go out again/);
  });
});

describe("the grants list tells wise's bounce from ops' own cancel", () => {
  test("a settlement is flagged bounced only while one of its payouts is", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    await db()
      .insert(settlements)
      .values({
        id: "9002",
        other_id: "ref-9002",
        npo_id: npo.id,
        date: days_ago(200),
        amount: 50,
        status: "cancelled",
      });
    await poll_wise_returns(state("cancelled"));

    const { items } = await npo_settlements(npo.id, {});

    expect(Object.fromEntries(items.map((i) => [i.id, i.bounced]))).toEqual({
      [transfer]: true,
      "9002": false,
    });
  });
});

describe("a transfer refunded while its payouts are still Sending", () => {
  test("takes them back as returned and credits the cash", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await funded(npo, ["p-1"]);
    expect(await npo_cash(npo.id)).toBe(400);

    await poll_wise_returns(state("funds_refunded"));

    expect(await types()).toEqual({ "p-1": "returned" });
    expect(await status_of(transfer)).toMatchObject({ status: "returned" });
    expect(await npo_cash(npo.id)).toBe(500);
  });
});

describe("a bounced transfer is Bounced and holds the npo", () => {
  test("a bounce wise moves back onto the ordinary path is Sending again, and the hold lifts", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    await funded(npo, ["p-1"]);
    await poll_wise_returns(state("bounced_back"));
    expect(await npo_return_hold(npo.id)).not.toBeNull();

    await poll_wise_returns(state("processing"));

    expect(await types()).toEqual({ "p-1": "processing" });
    expect(await npo_return_hold(npo.id)).toBeNull();
  });

  test("the bounce is alerted once, and tells ops the hold", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    await funded(npo, ["p-1"]);

    await poll_wise_returns(state("bounced_back"));
    await poll_wise_returns(state("bounced_back"));

    expect(send_alert).toHaveBeenCalledOnce();
    expect(send_alert.mock.calls[0]![0].title).toBe(
      `Wise transfer bounced_back: npo:${npo.id}`
    );
  });
});

describe("a payout paid by another route is settled, and never read as a wise transfer", () => {
  const seed_paid = async (
    npo_id: number,
    id: string,
    age_days: number,
    payout_type: "settled" | "refunded_loss" | "bounced" = "settled"
  ) => {
    await seed_payout(npo_id, `p-${id}`, 481.5);
    await db()
      .insert(settlements)
      .values({
        id,
        other_id: `mercury-${id}`,
        npo_id,
        date: days_ago(age_days),
        amount: 481.5,
        status: "paid",
      });
    await db()
      .update(payouts)
      .set({
        type: payout_type,
        settled_id: id,
        settled_date: days_ago(age_days),
      })
      .where(eq(payouts.id, `p-${id}`));
  };

  test.each([5, 120, 400])(
    "a paid settlement %s days old is never polled",
    async (age) => {
      const npo = await seed_npo(0);
      await seed_paid(npo.id, "9100", age);
      const lookup = vi.fn(state("bounced_back"));

      await poll_wise_returns(lookup);

      expect(lookup).not.toHaveBeenCalled();
      expect((await status_of("9100"))?.status).toBe("paid");
      expect(await types()).toEqual({ "p-9100": "settled" });
      expect(await npo_return_hold(npo.id)).toBeNull();
    }
  );

  test("its payouts and grant read settled on the lists, with no flag", async () => {
    const npo = await seed_npo(0);
    await seed_paid(npo.id, "9101", 5);

    const { items } = await npo_payouts(npo.id, {});
    const grants = await npo_settlements(npo.id, {});

    expect(items).toEqual([
      expect.objectContaining({ id: "p-9101", type: "settled" }),
    ]);
    expect(items[0]).not.toHaveProperty("charged_back");
    expect(grants.items[0]).toMatchObject({
      id: "9101",
      status: "paid",
      bounced: false,
    });
    expect(grant_state(grants.items[0]!)).toBe("settled");
  });

  test.each(["settled", "refunded_loss", "bounced"] as const)(
    "a paid run with a %s payout never holds the npo",
    async (payout_type) => {
      const npo = await seed_npo(0);
      await seed_paid(npo.id, "9102", 5, payout_type);

      expect(await npo_return_hold(npo.id)).toBeNull();
    }
  );

  test("a run with only paid and returned history leaves a new default bank unheld, and holds nobody before it", async () => {
    const npo = await seed_npo(0);
    await seed_payout(npo.id, "p-ret", 100);
    await db()
      .insert(settlements)
      .values({
        id: "9103",
        other_id: "ref-9103",
        npo_id: npo.id,
        date: days_ago(40),
        amount: 100,
        status: "returned",
        recipient_id: "old-bank",
      });
    await db()
      .update(payouts)
      .set({ type: "returned", settled_id: "9103" })
      .where(eq(payouts.id, "p-ret"));
    await seed_paid(npo.id, "9104", 10);

    // the returned run holds; the later paid run is not what holds
    expect(await npo_return_hold(npo.id)).toMatchObject({
      settlement_id: "9103",
      status: "returned",
    });

    // a different bank approved after the returned transfer lifts it
    await db()
      .insert(banking_apps)
      .values({
        id: "bank-new",
        npo_id: npo.id,
        status: "default",
        date_created: days_ago(5),
        updated_at: days_ago(5),
      });
    expect(await npo_return_hold(npo.id)).toBeNull();
  });

  test("taking a paid settlement back is a no-op: nothing moves, nothing is credited", async () => {
    const npo = await seed_npo(500);
    await seed_paid(npo.id, "9105", 5);

    const res = await return_settlement("9105", "some-recipient");

    expect(res.status).toBe("paid_elsewhere");
    expect(await types()).toEqual({ "p-9105": "settled" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect((await status_of("9105"))?.status).toBe("paid");
    // and it does not even store a recipient on it
    expect((await status_of("9105"))?.recipient).toBeNull();
  });
});
