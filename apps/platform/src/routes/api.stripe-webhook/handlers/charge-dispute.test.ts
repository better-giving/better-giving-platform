import { beforeEach, describe, expect, it, vi } from "vitest";

const intent_retrieve_mock = vi.hoisted(() => vi.fn());
const donation_get_mock = vi.hoisted(() => vi.fn());
const donation_by_sttl_id_mock = vi.hoisted(() => vi.fn());
const reverse_charge_mock = vi.hoisted(() => vi.fn());
const send_alert_mock = vi.hoisted(() => vi.fn());
const report_error_mock = vi.hoisted(() => vi.fn());
const enqueue_mock = vi.hoisted(() => vi.fn());
const charge_retrieve_mock = vi.hoisted(() => vi.fn());
const refunds_list_mock = vi.hoisted(() => vi.fn());
const load_reversible_mock = vi.hoisted(() => vi.fn());
const dispute_close_mock = vi.hoisted(() => vi.fn());
const dispute_won_mock = vi.hoisted(() => vi.fn());
const held_mock = vi.hoisted(() => vi.fn());
const reverse_routed_mock = vi.hoisted(() => vi.fn());
const routed_dispute_reversals_mock = vi.hoisted(() => vi.fn());

vi.mock("$/kit/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: intent_retrieve_mock },
    charges: { retrieve: charge_retrieve_mock },
    refunds: { list: refunds_list_mock },
  },
}));
vi.mock("$/pg/queries/donation", () => ({
  donation_get: donation_get_mock,
  donation_by_sttl_id: donation_by_sttl_id_mock,
}));
// the reversal and the dispute record are `.server/refund/`'s ground; here
// they are the boundary, and `../dispute.test.ts` runs them for real
vi.mock("$/refund/reverse", () => ({
  reverse_charge: reverse_charge_mock,
  load_reversible: load_reversible_mock,
}));
vi.mock("$/refund/dispute", () => ({ dispute_won: dispute_won_mock }));
// the transfers are `.server/stripe-connect/`'s; `../routed.test.ts` runs them
vi.mock("$/stripe-connect/release", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("$/stripe-connect/release")>();
  return {
    released_lines: real.released_lines,
    send_held: real.send_held,
    held_transfers: held_mock,
    routed_open_lines: vi.fn(async () => []),
  };
});
vi.mock("$/stripe-connect/reverse", () => ({
  reverse_routed_refunds: reverse_routed_mock,
  routed_dispute_reversals: routed_dispute_reversals_mock,
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/pg/queries/dispute", () => ({ dispute_close: dispute_close_mock }));
vi.mock("#/errors/report", () => ({ report_error: report_error_mock }));
vi.mock("$/kit/slack", () => ({
  fiat_monitor: { send_alert: send_alert_mock },
}));
vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));

const { handle_dispute_closed } = await import("./charge-dispute");

const { ReversalIncompleteError } = await import(
  "../helpers/reversal-incomplete"
);

const DON_ID = "0195c1f0-4c37-7c1a-b8f1-1f1f0a2f9d3e";
/** stripe's side of the $100 charge: refunds made before the dispute, newest first */
let refunds: { id: string; amount: number; status: string }[] = [];

const dispute_event = (type: string, status: string, amount = 10_000) =>
  ({
    id: `evt_${type}`,
    type,
    created: 1_793_456_000,
    data: {
      object: {
        id: "dp_1",
        amount,
        currency: "usd",
        charge: "ch_1",
        payment_intent: "pi_1",
        reason: "fraudulent",
        status,
        created: 1_790_000_000,
        evidence_details: { due_by: 1_767_225_600 },
        balance_transactions: [
          { id: "txn_1", amount: -10_000, fee: 1_500, currency: "usd" },
        ],
      },
    },
  }) as any;

/** the ops notice lines the latest reversal was handed */
const notice_text = () =>
  reverse_charge_mock.mock.lastCall![0].notice.lines.join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  refunds = [];
  charge_retrieve_mock.mockImplementation(async () => ({
    id: "ch_1",
    amount: 10_000,
    amount_captured: 10_000,
    currency: "usd",
  }));
  refunds_list_mock.mockImplementation(async () => ({ data: [...refunds] }));
  const settled = async () => ({
    id: DON_ID,
    status: "settled",
    via: "stripe:card",
    settlement: { id: "pi_1", fee: 320, currency: "USD" },
    form_id: "form-1",
    program: { id: "prog-1", name: "Clean Water" },
  });
  donation_by_sttl_id_mock.mockImplementation(settled);
  donation_get_mock.mockImplementation(settled);
  load_reversible_mock.mockResolvedValue({ status: "reversible" });
  // what a reversal answers is each test's to say; `../dispute.test.ts` and
  // `../refund.test.ts` run the real one and judge the outcome
  reverse_charge_mock.mockResolvedValue({
    status: "reversed",
    dists: 1,
    applied: 1,
    owed_msgs: [],
    has_loss: false,
  });
  send_alert_mock.mockResolvedValue(undefined);
  enqueue_mock.mockResolvedValue(undefined);
  held_mock.mockResolvedValue([]);
  reverse_routed_mock.mockResolvedValue([]);
  routed_dispute_reversals_mock.mockResolvedValue([]);
});

const HELD = { id: "dist-1", to_id: 7, net: 90, stripe_routed_to: "acct_1" };

/** the fiat notices enqueued, title and body */
const notices = () =>
  enqueue_mock.mock.calls
    .flat()
    .filter((m) => m.id === "fiat-notice")
    .map((m) => `${m.payload.alert.title}\n${m.payload.alert.body}`);

/** the kinds of each enqueue call's messages, in order */
const enqueued_ids = () =>
  enqueue_mock.mock.calls.map((c) => c.map((m) => m.id));

describe("stripe charge.dispute.closed → reversal on a loss", () => {
  it("reverses a lost dispute's donation and tells ops what it cost, fee included", async () => {
    await handle_dispute_closed(dispute_event("charge.dispute.closed", "lost"));

    expect(reverse_charge_mock).toHaveBeenCalledExactlyOnceWith({
      donation_id: DON_ID,
      rail: "stripe",
      source: "dispute",
      share: { taken: 10_000, of: 10_000 },
      refunds: [],
      dispute_id: "dp_1",
      dispute_fee_usd: 15,
      source_ref: "dp_1",
      alert_from: "charge-dispute",
      notice: { id: "evt_charge.dispute.closed", lines: expect.any(Array) },
    });
    const text = notice_text();
    expect(text).toContain(DON_ID);
    expect(text).toContain("100.00 USD");
    expect(text).toMatch(/fee.*15\.00 USD/);
  });

  it("hands a lost dispute covering only part of the gift over as that share", async () => {
    reverse_charge_mock.mockResolvedValue({
      status: "partial_owed",
      owed_msgs: [],
    });

    await expect(
      handle_dispute_closed(
        dispute_event("charge.dispute.closed", "lost", 4_000)
      )
    ).resolves.toBeUndefined();

    expect(reverse_charge_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "dispute",
        share: { taken: 4_000, of: 10_000 },
        dispute_fee_usd: 15,
      })
    );
    const text = notice_text();
    expect(text).toContain(DON_ID);
    expect(text).toContain("40.00 USD of 100.00 USD");
    expect(text).toMatch(/fee.*15\.00 USD/);
  });

  it("keys a partial loss's notice on the event, so a redelivery collapses into it", async () => {
    reverse_charge_mock.mockResolvedValue({
      status: "partial_owed",
      owed_msgs: [],
    });
    const partial = dispute_event("charge.dispute.closed", "lost", 4_000);
    await handle_dispute_closed(partial);
    await handle_dispute_closed(partial);

    const [first, again] = reverse_charge_mock.mock.calls.map(
      ([r]) => r.notice.id
    );
    expect(first).toBe(partial.id);
    expect(again).toBe(first);
  });

  it("hands over the succeeded refunds a lost dispute's part is added to, a pending one left out", async () => {
    refunds = [
      { id: "re_2", amount: 1_000, status: "pending" },
      { id: "re_1", amount: 6_000, status: "succeeded" },
    ];

    await handle_dispute_closed(
      dispute_event("charge.dispute.closed", "lost", 4_000)
    );

    expect(reverse_charge_mock).toHaveBeenCalledOnce();
    const handed = reverse_charge_mock.mock.lastCall![0];
    // its own part; the refunds it names are each their own take
    expect(handed.share).toEqual({ taken: 4_000, of: 10_000 });
    expect(handed.refunds).toEqual([{ id: "re_1", amount: 6_000 }]);
    expect(notice_text()).toContain("60.00 USD (re_1, succeeded)");
  });

  it("acknowledges a lost dispute on a donation already reversed, asking stripe nothing", async () => {
    load_reversible_mock.mockResolvedValue({
      status: "already_reversed",
      donation_status: "refunded",
    });
    charge_retrieve_mock.mockRejectedValue(new Error("stripe unavailable"));

    await expect(
      handle_dispute_closed(dispute_event("charge.dispute.closed", "lost"))
    ).resolves.toBeUndefined();

    expect(reverse_charge_mock).not.toHaveBeenCalled();
  });

  const failing = {
    status: "failed",
    reason: "incomplete",
    dists: 1,
    applied: 0,
    failures: ["dist dist_1: db timeout"],
  };

  it("fails the delivery when dists fail to reverse", async () => {
    reverse_charge_mock.mockResolvedValue(failing);

    await expect(
      handle_dispute_closed(dispute_event("charge.dispute.closed", "lost"))
    ).rejects.toBeInstanceOf(ReversalIncompleteError);
  });

  it("completes a failed reversal on redelivery, keyed on the same event", async () => {
    reverse_charge_mock
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(failing);
    const lost = dispute_event("charge.dispute.closed", "lost");

    await expect(handle_dispute_closed(lost)).rejects.toThrow();
    await expect(handle_dispute_closed(lost)).rejects.toThrow();
    await expect(handle_dispute_closed(lost)).resolves.toBeUndefined();

    const ids = reverse_charge_mock.mock.calls.map(([r]) => r.notice.id);
    expect(ids).toEqual([lost.id, lost.id, lost.id]);
  });
});

describe("stripe charge.dispute.closed → the routed transfers", () => {
  it("reverses the loss's cut of the sent transfers ahead of the reversal, telling ops in its notice", async () => {
    refunds = [
      { id: "re_2", amount: 1_000, status: "pending" },
      { id: "re_1", amount: 2_000, status: "succeeded" },
    ];
    reverse_routed_mock.mockImplementation(async () => {
      expect(reverse_charge_mock).not.toHaveBeenCalled();
      return ["dist-1 to npo 7: $36.00 reversed from transfer tr_1"];
    });

    await handle_dispute_closed(
      dispute_event("charge.dispute.closed", "lost", 4_000)
    );

    expect(reverse_routed_mock).toHaveBeenCalledExactlyOnceWith(DON_ID, {
      of: 10_000,
      refunds: [{ id: "re_1", amount: 2_000 }],
      unsent: ["re_2"],
    });
    expect(notice_text()).toContain("$36.00 reversed from transfer tr_1");
  });

  it("fails the delivery when a routed reversal throws, reversing nothing else", async () => {
    reverse_routed_mock.mockRejectedValue(new Error("socket hang up"));

    await expect(
      handle_dispute_closed(dispute_event("charge.dispute.closed", "lost"))
    ).rejects.toThrow("socket hang up");

    expect(reverse_charge_mock).not.toHaveBeenCalled();
  });

  it("releases the held transfers on a partial loss, naming them in the notice", async () => {
    held_mock.mockResolvedValue([HELD]);

    await handle_dispute_closed(
      dispute_event("charge.dispute.closed", "lost", 4_000)
    );

    expect(held_mock).toHaveBeenCalledExactlyOnceWith(DON_ID);
    expect(notice_text()).toContain("dist dist-1: transfer to npo 7 released");
  });

  // stripe redelivers a failed delivery; the held dists are read again then
  it("sends a partial loss's released transfers only once its notice is queued", async () => {
    held_mock.mockResolvedValue([HELD]);
    reverse_charge_mock.mockRejectedValueOnce(new Error("qstash 503"));
    const lost = dispute_event("charge.dispute.closed", "lost", 4_000);

    await expect(handle_dispute_closed(lost)).rejects.toThrow("qstash 503");
    expect(enqueue_mock).not.toHaveBeenCalled();
    await handle_dispute_closed(lost);

    expect(notice_text()).toContain("dist dist-1: transfer to npo 7 released");
    expect(enqueued_ids()).toEqual([["connect-transfer"]]);
    expect(enqueue_mock.mock.calls[0]![0].payload).toEqual({
      dist_id: "dist-1",
      donation_id: DON_ID,
      intent_id: "pi_1",
      release: "dp_1",
    });
  });

  it("releases nothing on a full loss", async () => {
    await handle_dispute_closed(dispute_event("charge.dispute.closed", "lost"));

    expect(held_mock).not.toHaveBeenCalled();
  });

  it.each([
    ["won", { status: "credited", owed: [] }],
    ["warning_closed", undefined],
  ])(
    "releases the held transfers on a close %s, telling ops once per event",
    async (status, won) => {
      dispute_won_mock.mockResolvedValue(won);
      held_mock.mockResolvedValue([HELD]);
      const event = dispute_event("charge.dispute.closed", status);

      await handle_dispute_closed(event);

      expect(held_mock).toHaveBeenCalledExactlyOnceWith(DON_ID);
      const [notice] = enqueue_mock.mock.calls.flat();
      expect(notice).toMatchObject({ dedupe: `fiat.notice_${event.id}` });
      expect(notices()).toEqual([
        expect.stringMatching(
          /^Dispute Closed: Held Transfers Released\n.*\n.*\ndist dist-1: transfer to npo 7 released/
        ),
      ]);
    }
  );

  it("queues a close's release notice ahead of the transfers, so the redelivery of a lost notice sends both", async () => {
    dispute_won_mock.mockResolvedValue({ status: "credited", owed: [] });
    held_mock.mockResolvedValue([HELD]);
    enqueue_mock.mockRejectedValueOnce(new Error("qstash 503"));
    const event = dispute_event("charge.dispute.closed", "won");

    await expect(handle_dispute_closed(event)).rejects.toThrow("qstash 503");
    await handle_dispute_closed(event);

    expect(enqueued_ids()).toEqual([
      ["fiat-notice"],
      ["fiat-notice"],
      ["connect-transfer"],
    ]);
    expect(notices()).toEqual([
      expect.stringContaining("dist dist-1: transfer to npo 7 released"),
      expect.stringContaining("dist dist-1: transfer to npo 7 released"),
    ]);
  });

  it("tells ops nothing when a favourable close released nothing", async () => {
    dispute_won_mock.mockResolvedValue({ status: "credited", owed: [] });

    await handle_dispute_closed(dispute_event("charge.dispute.closed", "won"));

    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it.each([
    ["conflict", { status: "conflict", prior_status: "lost" }],
    [
      "already reversed",
      {
        status: "already_reversed",
        donation_status: "refunded",
        prior_status: "lost",
        credited: true,
        hand: false,
      },
    ],
  ])(
    "a win %s releases nothing and tells ops to re-pay what its loss reversed",
    async (_case, won) => {
      dispute_won_mock.mockResolvedValue(won);
      routed_dispute_reversals_mock.mockResolvedValue([
        "dist-1: $36.00 reversed from transfer tr_1 for this dispute; re-pay it to the nonprofit by hand",
      ]);

      await handle_dispute_closed(
        dispute_event("charge.dispute.closed", "won")
      );

      expect(held_mock).not.toHaveBeenCalled();
      expect(routed_dispute_reversals_mock).toHaveBeenCalledWith(DON_ID, {
        id: "dp_1",
        amount: 10_000,
        charge: "ch_1",
        created_at: new Date(1_790_000_000 * 1000).toISOString(),
      });
      expect(notices()).toEqual([
        expect.stringContaining("re-pay it to the nonprofit by hand"),
      ]);
    }
  );
});
