import { beforeEach, describe, expect, it, vi } from "vitest";
import { alert_text } from "#/__tests__/fixtures/alert-text";
import type { ChargeReversal } from "$/refund/reverse";

const intent_retrieve_mock = vi.hoisted(() => vi.fn());
const charge_retrieve_mock = vi.hoisted(() => vi.fn());
const refunds_list_mock = vi.hoisted(() => vi.fn());
const donation_get_mock = vi.hoisted(() => vi.fn());
const donation_by_sttl_id_mock = vi.hoisted(() => vi.fn());
const reverse_charge_mock = vi.hoisted(() => vi.fn());
const send_alert_mock = vi.hoisted(() => vi.fn());
const report_error_mock = vi.hoisted(() => vi.fn());
const enqueue_mock = vi.hoisted(() => vi.fn());

vi.mock("$/kit/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: intent_retrieve_mock },
    charges: { retrieve: charge_retrieve_mock },
    refunds: { list: refunds_list_mock },
  },
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/pg/queries/donation", () => ({
  donation_get: donation_get_mock,
  donation_by_sttl_id: donation_by_sttl_id_mock,
}));
// the reversal is `reverse.test.ts`'s ground; here it is the boundary, and
// what the handler hands it is the handler's whole answer
vi.mock("$/refund/reverse", () => ({ reverse_charge: reverse_charge_mock }));
vi.mock("#/errors/report", () => ({ report_error: report_error_mock }));
vi.mock("$/kit/slack", () => ({
  fiat_monitor: { send_alert: send_alert_mock },
}));
vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));

const { handle_charge_refunded } = await import("./charge-refunded");
const { handle_refund_updated } = await import("./refund-updated");

const { ReversalIncompleteError } = await import(
  "../helpers/reversal-incomplete"
);

const ORDER_ID = "0195c1f0-4c37-7c1a-b8f1-1f1f0a2f9d3e";
const AMOUNT = 10_000;

/** stripe's side of one $100 usd charge; refunds newest first, as stripe lists them */
let refunds: {
  id: string;
  amount: number;
  status: string;
  created: number;
}[] = [];
let don_status = "settled";
let clock = 1_700_000_000;

// as stripe returns it: the share is read off the refund list, not a
// refunded total stripe doesn't document for pending or failed refunds
const charge_now = () => ({
  id: "ch_1",
  payment_intent: "pi_1",
  currency: "usd",
  amount: AMOUNT,
  amount_captured: AMOUNT,
});

/** the event's own copy of the charge names its refunded total */
const live_refunded = () =>
  refunds
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .reduce((sum, r) => sum + r.amount, 0);

/** support refunds `amount` from the dashboard; returns the event stripe sends
 * for it. a bank refund (ach, acss) starts pending */
const refund = (amount: number, status = "succeeded") => {
  const before = live_refunded();
  clock += 60;
  refunds.unshift({
    id: `re_${refunds.length + 1}`,
    amount,
    status,
    created: clock,
  });
  return {
    id: `evt_${refunds.length}`,
    type: "charge.refunded",
    created: clock,
    data: {
      object: { ...charge_now(), amount_refunded: live_refunded() },
      // unconfirmed that stripe sends this on charge.refunded; tests that
      // delete it cover the event without it
      previous_attributes: { amount_refunded: before },
    },
  } as any;
};

/** the bank settles refund `id` as `status`; returns stripe's refund.updated for it */
const settle = (id: string, status: string) => {
  const r = refunds.find((x) => x.id === id);
  if (!r) throw new Error(`no refund ${id}`);
  const previous = r.status;
  r.status = status;
  clock += 60;
  return {
    id: `evt_${id}_${status}`,
    type: "refund.updated",
    created: clock,
    data: {
      object: { ...r, charge: "ch_1", payment_intent: "pi_1", currency: "usd" },
      previous_attributes: { status: previous },
    },
  } as any;
};

/** notices the handler queues itself, for retried delivery */
const queued = () =>
  enqueue_mock.mock.calls.flat().filter((m) => m.id === "fiat-notice");

/** what each reversal was handed, in order */
const reversals = (): ChargeReversal[] =>
  reverse_charge_mock.mock.calls.map(([r]) => r);

const partial_owed = { status: "partial_owed", owed_msgs: [] };
const reversed = {
  status: "reversed",
  dists: 1,
  applied: 1,
  owed_msgs: [],
  has_loss: false,
};
const incomplete = {
  status: "failed",
  reason: "incomplete",
  dists: 1,
  applied: 0,
  failures: ["dist dist_1: db timeout"],
};

beforeEach(() => {
  vi.clearAllMocks();
  refunds = [];
  don_status = "settled";
  clock = 1_700_000_000;
  intent_retrieve_mock.mockResolvedValue({
    id: "pi_1",
    metadata: { order_id: ORDER_ID },
  });
  charge_retrieve_mock.mockImplementation(async () => charge_now());
  refunds_list_mock.mockImplementation(async () => ({ data: [...refunds] }));
  donation_get_mock.mockImplementation(async (id: string) => ({
    id,
    status: don_status,
    via: "stripe:card",
    settlement: { id: "pi_1", fee: 320, currency: "USD" },
    form_id: null,
    program: null,
  }));
  donation_by_sttl_id_mock.mockResolvedValue(undefined);
  // what a reversal answers is each test's to say; `reverse.test.ts` and
  // `../refund.test.ts` run the real one and judge the outcome
  reverse_charge_mock.mockResolvedValue(partial_owed);
  send_alert_mock.mockResolvedValue(undefined);
  enqueue_mock.mockResolvedValue(undefined);
});

describe("stripe charge.refunded → hand-over to the reversal", () => {
  // resolving is what the route turns into a 200, so stripe stops redelivering
  it("hands a partial refund over as its share of the charge", async () => {
    await expect(handle_charge_refunded(refund(500))).resolves.toBeUndefined();

    expect(reversals()).toEqual([
      expect.objectContaining({
        donation_id: ORDER_ID,
        rail: "stripe",
        source: "refund",
        share: { taken: 500, of: AMOUNT },
        unsent_refunds: [],
        source_ref: "re_1",
        alert_from: "charge-refunded",
      }),
    ]);
  });

  // a refund credited back as failed since the list was read isn't owed again
  it("hands over the refunds its share counts, a failed one left out", async () => {
    refund(500);
    refunds[0].status = "failed";
    refund(1_000);

    await handle_charge_refunded(refund(2_000, "pending"));

    // each with its time at stripe, which tells a claim's refund from an earlier one
    const at = (id: string) =>
      new Date(refunds.find((r) => r.id === id)!.created * 1000).toISOString();
    expect(reversals().map((r) => r.refunds)).toEqual([
      [
        { id: "re_3", amount: 2_000, created_at: at("re_3") },
        { id: "re_2", amount: 1_000, created_at: at("re_2") },
      ],
    ]);
  });

  // the intent names the recurring gift the entry ends
  it("hands a full refund over as the whole charge, with its intent and the refund that completed it", async () => {
    reverse_charge_mock.mockResolvedValue(reversed);

    await handle_charge_refunded(refund(AMOUNT));

    expect(reverse_charge_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        donation_id: ORDER_ID,
        share: { taken: AMOUNT, of: AMOUNT },
        unsent_refunds: [],
        intent_id: "pi_1",
        source_ref: "re_1",
      })
    );
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("hands the bank refund that completes the charge over as unsent while it is pending", async () => {
    reverse_charge_mock.mockResolvedValue({ status: "held" });

    await expect(
      handle_charge_refunded(refund(AMOUNT, "pending"))
    ).resolves.toBeUndefined();

    expect(reversals().map((r) => r.unsent_refunds)).toEqual([["re_1"]]);
  });

  it("does nothing for a refund event once every refund on the charge failed", async () => {
    const bounced = refund(500);
    refunds[0].status = "failed";

    await expect(handle_charge_refunded(bounced)).resolves.toBeUndefined();

    expect(reverse_charge_mock).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });

  it("does not hand over a donation that is already reversed", async () => {
    don_status = "refunded"; // the admin action reversed it

    await expect(
      handle_charge_refunded(refund(AMOUNT))
    ).resolves.toBeUndefined();

    expect(reverse_charge_mock).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });

  it("reverses the rebill a refunded subscription charge settled, not the order it was cloned from", async () => {
    const REBILL_ID = "0195c1f0-4c37-7c1a-b8f1-2f2f0a2f9d3e";
    // subscription invoice intents carry no metadata
    intent_retrieve_mock.mockResolvedValue({ id: "pi_1", metadata: {} });
    donation_by_sttl_id_mock.mockImplementation(async (id: string) =>
      id === "pi_1"
        ? { id: REBILL_ID, status: don_status, form_id: null, program: null }
        : undefined
    );

    await expect(
      handle_charge_refunded(refund(AMOUNT))
    ).resolves.toBeUndefined();

    expect(reverse_charge_mock).toHaveBeenCalledWith(
      expect.objectContaining({ donation_id: REBILL_ID })
    );
  });
});

describe("stripe charge.refunded → what a held or failed reversal does to the delivery", () => {
  it("tells ops once that the reversal waits on the pending refund succeeding", async () => {
    reverse_charge_mock.mockResolvedValue({ status: "held" });
    const created = refund(AMOUNT, "pending");

    await handle_charge_refunded(created);
    await handle_charge_refunded(created); // stripe redelivers

    const held = queued().filter((m) => m.payload.id === "re_1_held");
    expect(held).toHaveLength(2);
    expect(new Set(held.map((m) => m.dedupe))).toEqual(
      new Set(["fiat.notice_re_1_held"])
    );
    const text = alert_text(held[0].payload.alert);
    expect(text).toContain(`donation ${ORDER_ID}`);
    expect(text).toContain("100.00 USD (re_1, pending)");
    expect(text).toMatch(/refund\.updated/);
  });

  it("fails the delivery when the held-reversal notice can't be queued", async () => {
    reverse_charge_mock.mockResolvedValue({ status: "held" });
    enqueue_mock.mockRejectedValue(new Error("qstash 503"));

    await expect(
      handle_charge_refunded(refund(AMOUNT, "pending"))
    ).rejects.toThrow("qstash 503");
  });

  it("fails the delivery when a reversal leaves dists unreversed", async () => {
    reverse_charge_mock.mockResolvedValue(incomplete);

    await expect(handle_charge_refunded(refund(AMOUNT))).rejects.toBeInstanceOf(
      ReversalIncompleteError
    );
  });

  it("fails the delivery with what failed when the reversal leaves some of several dists unreversed", async () => {
    reverse_charge_mock.mockResolvedValue({
      ...incomplete,
      dists: 2,
      applied: 1,
      failures: ["dist dist_2: db timeout"],
    });

    await expect(handle_charge_refunded(refund(9_500))).rejects.toThrow(
      `1 of 2 dists failed to reverse: ${ORDER_ID}`
    );
  });

  it("a redelivery that completes a reversal left short hands over the same completing refund each time", async () => {
    reverse_charge_mock
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(reversed);
    refund(500);
    const completing = refund(9_500);

    await expect(handle_charge_refunded(completing)).rejects.toThrow();
    await expect(handle_charge_refunded(completing)).rejects.toThrow();
    await expect(handle_charge_refunded(completing)).resolves.toBeUndefined();

    expect(reversals().map((r) => r.source_ref)).toEqual([
      "re_2",
      "re_2",
      "re_2",
    ]);
  });

  // the notice is the only record ops gets, so a lost one must be redelivered
  it("fails the delivery when the reversal can't queue its notice", async () => {
    reverse_charge_mock.mockRejectedValueOnce(new Error("qstash 503"));

    await expect(handle_charge_refunded(refund(500))).rejects.toThrow(
      "qstash 503"
    );
  });
});

describe("stripe refund.updated → hand-over to the reversal", () => {
  it("hands a refund over once the pending bank refund that completed the charge succeeds", async () => {
    reverse_charge_mock.mockResolvedValue({ status: "held" });
    await handle_charge_refunded(refund(AMOUNT, "pending"));
    reverse_charge_mock.mockResolvedValue(reversed);

    await expect(
      handle_refund_updated(settle("re_1", "succeeded"))
    ).resolves.toBeUndefined();

    expect(reversals().at(-1)).toMatchObject({
      donation_id: ORDER_ID,
      share: { taken: AMOUNT, of: AMOUNT },
      unsent_refunds: [],
      source_ref: "re_1",
      alert_from: "refund-updated",
    });
  });

  it("hands a partial bank refund over as its share once it succeeds, its notice keyed on the update", async () => {
    await handle_charge_refunded(refund(500, "pending"));

    await handle_refund_updated(settle("re_1", "succeeded"));

    expect(reversals().at(-1)).toMatchObject({
      share: { taken: 500, of: AMOUNT },
      unsent_refunds: [],
      source_ref: "re_1",
      notice: expect.objectContaining({ id: "evt_re_1_succeeded" }),
    });
  });
});
