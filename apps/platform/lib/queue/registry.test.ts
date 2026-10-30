import { describe, expect, test } from "vitest";
import {
  KINDS,
  type Kind,
  lane_of,
  type MsgInput,
  msg,
  retries_of,
} from "./registry";

describe("msg() — dedupe keys are wire-format and must not drift", () => {
  // per-row payload shape varies; rely on the test calling msg() to enforce
  // the shape, not the row tuple.
  const rows: Array<[Kind, Record<string, unknown>, string]> = [
    ["banking-approved", { npo_id: 42 }, "banking.approved_42"],
    ["banking-default", { npo_id: 42 }, "banking.default_42"],
    ["banking-new", { npo_id: 42 }, "banking.new_42"],
    ["banking-rejected", { npo_id: 42 }, "banking.rejected_42"],
    // one transfer per routed dist, however often settlement resends it
    ["connect-transfer", { dist_id: "dist-1" }, "connect.transfer_dist-1"],
    // a dispute's release is its own message, never collapsed into the
    // settlement's send that held
    [
      "connect-transfer",
      { dist_id: "dist-1", release: "dp_1" },
      "connect.transfer_dist-1_dp_1",
    ],
    ["don-dist", { id: "d1", to_id: 7 }, "don.dist_d1_7"],
    ["don-fund-receipt", { id: "d5", attempt: 2 }, "don.fund-receipt_d5_2"],
    ["don-match", { id: "d4" }, "don.match_d4"],
    ["don-match-chase", { id: "d4" }, "don.match-chase_d4"],
    ["don-sttl-dist", { id: "d2" }, "don.sttl-dist_d2"],
    ["don-sttl-receipt", { id: "d3" }, "don.sttl-receipt_d3"],
    ["fiat-notice", { id: "evt_1" }, "fiat.notice_evt_1"],
    [
      "fund-member-removed",
      { fund_id: "f1", creator_id: "u1", npo_id: 7 },
      "fund.removed_f1_u1_7",
    ],
    [
      "invite-email",
      { invitee: "x@y.z", npo_id: 7, sent_at: "2026-10-02T12:30:45.678Z" },
      "invite_x@y.z_7_2026-10-02T123045.678Z",
    ],
    [
      "paypal-order-capture",
      { order_id: "O-1", don_id: "d6" },
      "paypal.order-capture_O-1",
    ],
    [
      "lock-tx-created",
      { npo_id: 9, date_created: "2026-01-02T03:04:05Z" },
      "lock_tx_9_2026-01-02T030405Z",
    ],
    // one message per notice row, and a notice row is one per owed row, kind
    // and round
    ["owed-notice", { id: "n1" }, "owed.notice_n1"],
    ["reg-created", { id: "r1" }, "reg.created_r1"],
    [
      "reg-updated",
      { id: "r2", status: "02", updated_at: "2026-09-01T10:20:30.456Z" },
      "reg.updated_r2_02_2026-09-01T102030.456Z",
    ],
    [
      "sub-cancel-failed-email",
      { id: "s4", cancelled_at: "2026-10-02T12:30:45.678Z" },
      "sub.cancel-failed-email_s4_2026-10-02T123045.678Z",
    ],
    ["sub-deactivated", { id: "s1" }, "sub.deactivated_s1"],
    [
      "sub-deactivated",
      {
        id: "s2",
        by_donor: true,
        cancel_requested_at: "2026-10-02T12:30:45.678Z",
      },
      "sub.deactivated_s2_2026-10-02T123045.678Z",
    ],
    ["tip-received", { id: "t1" }, "tip_t1"],
  ];

  test.each(rows)("dedupe(%s)", (kind, payload, expected) => {
    // payloads in the table are minimal fixtures; cast to bypass per-row
    // shape narrowing — msg() runs its dedupe recipe on the raw object.
    const m = msg(kind, payload as never);
    expect(m.dedupe).toBe(expected);
    expect(m.id).toBe(kind);
  });

  test("rows cover every registered Kind", () => {
    const covered = new Set(rows.map(([k]) => k));
    for (const k of KINDS) expect(covered.has(k)).toBe(true);
    expect(covered.size).toBe(KINDS.length);
  });
});

describe("sub-deactivated dedupe", () => {
  // keyed `..._undefined`, every donor cancel of a sub would dedupe to one
  test("a donor's cancel cannot be enqueued without its cancel_requested_at", () => {
    expect(() =>
      // @ts-expect-error cancel_requested_at is required with by_donor
      msg("sub-deactivated", { id: "s3", platform: "stripe", by_donor: true })
    ).toThrow();
    expect(
      msg("sub-deactivated", { id: "s3", platform: "stripe" }).dedupe
    ).toBe("sub.deactivated_s3");
  });
});

describe("sub-cancel-failed-email delivery", () => {
  // the restore it follows has already flipped the row: only the queue retries the mail
  test("retries like the other mail-only kinds", () => {
    expect(retries_of("sub-cancel-failed-email")).toBe(
      retries_of("invite-email")
    );
    expect(retries_of("sub-cancel-failed-email")).toBeGreaterThan(0);
  });
});

describe("paypal-order-capture delivery", () => {
  test("holds past the browser's capture, then retries for over a day", () => {
    const m = msg("paypal-order-capture", { order_id: "O-1", don_id: "d6" });
    expect({ delay_s: m.delay_s, retries: m.retries }).toEqual({
      delay_s: 300,
      retries: 5,
    });
  });
});

describe("fund-member-removed dedupe", () => {
  const removal = (npo_id: number) => ({
    fund_id: "f1",
    creator_id: "u1",
    creator_name: "Ocean Fund",
    npo_id,
  });

  test("a second nonprofit leaving the same fund is its own message", () => {
    expect(msg("fund-member-removed", removal(8)).dedupe).not.toBe(
      msg("fund-member-removed", removal(7)).dedupe
    );
  });
});

describe("invite-email dedupe", () => {
  const SENT_AT = "2026-10-02T12:30:45.678Z";
  const invite = (npo_id: number, sent_at = SENT_AT) => ({
    invitee: "ada@test.com",
    invitee_first_name: "Ada",
    invitor: "admin@test.com",
    npo_id,
    npo_name: `npo ${npo_id}`,
    sent_at,
  });

  test("an invite to a second nonprofit is its own message", () => {
    expect(msg("invite-email", invite(8)).dedupe).not.toBe(
      msg("invite-email", invite(7)).dedupe
    );
  });

  // a re-invite refreshes the expiry, so the invitee needs the new mail
  test("the same nonprofit re-inviting is its own message", () => {
    expect(
      msg("invite-email", invite(7, "2026-10-02T12:31:00.000Z")).dedupe
    ).not.toBe(msg("invite-email", invite(7)).dedupe);
  });

  test("one invite keeps its key", () => {
    expect(msg("invite-email", invite(7)).dedupe).toBe(
      msg("invite-email", invite(7)).dedupe
    );
  });
});

describe("reg-updated dedupe", () => {
  const row: MsgInput<"reg-updated"> = {
    id: "r2",
    status: "01",
    updated_at: "2026-09-01T10:20:30.456Z",
  };

  // a double-enqueued write of one row state is one message; a submitted (02)
  // delivery files a hubspot deal.
  test("is the same for the same row state", () => {
    expect(msg("reg-updated", { ...row }).dedupe).toBe(
      msg("reg-updated", { ...row }).dedupe
    );
  });

  test("differs after a new save", () => {
    const next = { ...row, updated_at: "2026-09-01T10:20:31.002Z" };
    expect(msg("reg-updated", next).dedupe).not.toBe(
      msg("reg-updated", row).dedupe
    );
  });

  test("differs on a status change", () => {
    const submitted: MsgInput<"reg-updated"> = { ...row, status: "02" };
    expect(msg("reg-updated", submitted).dedupe).not.toBe(
      msg("reg-updated", row).dedupe
    );
  });
});

describe("connect-transfer delivery", () => {
  // a lost one leaves a routed npo unpaid with nothing else to retry it
  test("retries", () => {
    expect(retries_of("connect-transfer")).toBeGreaterThan(0);
  });
});

describe("retries_of", () => {
  test("reads a kind's configured retries, 0 for an at-most-once kind", () => {
    expect(retries_of("sub-deactivated")).toBe(3);
    expect(retries_of("don-dist")).toBe(4);
    expect(retries_of("reg-updated")).toBe(0);
  });
});

describe("msg() — delivery is wire-format too", () => {
  // one fixture per kind, wide enough for every dedupe recipe. the snapshot
  // was taken before kinds were split across queues: a diff here changes
  // production retries or dedupe keys.
  const fixture = {
    id: "x1",
    npo_id: 7,
    to_id: 7,
    dist_id: "dist-1",
    fund_id: "f1",
    creator_id: "u1",
    invitee: "x@y.z",
    sent_at: "2026-10-02T12:30:45.678Z",
    date_created: "2026-01-02T03:04:05Z",
    order_id: "O-1",
    status: "02",
    updated_at: "2026-09-01T10:20:30.456Z",
    cancelled_at: "2026-10-02T12:30:45.678Z",
  };

  test("every kind's msg() minus its payload", () => {
    const out = Object.fromEntries(
      KINDS.map((k) => {
        const { payload: _, ...rest } = msg(k, fixture as never);
        return [k, rest];
      })
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "banking-approved": {
          "dedupe": "banking.approved_7",
          "id": "banking-approved",
          "retries": 3,
        },
        "banking-default": {
          "dedupe": "banking.default_7",
          "id": "banking-default",
          "retries": 3,
        },
        "banking-new": {
          "dedupe": "banking.new_7",
          "id": "banking-new",
          "retries": 3,
        },
        "banking-rejected": {
          "dedupe": "banking.rejected_7",
          "id": "banking-rejected",
          "retries": 3,
        },
        "connect-transfer": {
          "dedupe": "connect.transfer_dist-1",
          "id": "connect-transfer",
          "retries": 3,
        },
        "don-dist": {
          "dedupe": "don.dist_x1_7",
          "id": "don-dist",
          "retries": 4,
        },
        "don-fund-receipt": {
          "dedupe": "don.fund-receipt_x1_0",
          "id": "don-fund-receipt",
        },
        "don-match": {
          "dedupe": "don.match_x1",
          "id": "don-match",
          "retries": 3,
        },
        "don-match-chase": {
          "dedupe": "don.match-chase_x1",
          "delay_s": 259200,
          "id": "don-match-chase",
        },
        "don-sttl-dist": {
          "dedupe": "don.sttl-dist_x1",
          "id": "don-sttl-dist",
        },
        "don-sttl-receipt": {
          "dedupe": "don.sttl-receipt_x1",
          "id": "don-sttl-receipt",
          "retries": 3,
        },
        "fiat-notice": {
          "dedupe": "fiat.notice_x1",
          "id": "fiat-notice",
          "retries": 3,
        },
        "fund-member-removed": {
          "dedupe": "fund.removed_f1_u1_7",
          "id": "fund-member-removed",
          "retries": 3,
        },
        "invite-email": {
          "dedupe": "invite_x@y.z_7_2026-10-02T123045.678Z",
          "id": "invite-email",
          "retries": 3,
        },
        "lock-tx-created": {
          "dedupe": "lock_tx_7_2026-01-02T030405Z",
          "id": "lock-tx-created",
          "retries": 3,
        },
        "owed-notice": {
          "dedupe": "owed.notice_x1",
          "id": "owed-notice",
          "retries": 3,
        },
        "paypal-order-capture": {
          "dedupe": "paypal.order-capture_O-1",
          "delay_s": 300,
          "id": "paypal-order-capture",
          "retries": 5,
        },
        "reg-created": {
          "dedupe": "reg.created_x1",
          "id": "reg-created",
          "retries": 3,
        },
        "reg-updated": {
          "dedupe": "reg.updated_x1_02_2026-09-01T102030.456Z",
          "id": "reg-updated",
        },
        "sub-cancel-failed-email": {
          "dedupe": "sub.cancel-failed-email_x1_2026-10-02T123045.678Z",
          "id": "sub-cancel-failed-email",
          "retries": 3,
        },
        "sub-deactivated": {
          "dedupe": "sub.deactivated_x1",
          "id": "sub-deactivated",
          "retries": 3,
        },
        "tip-received": {
          "dedupe": "tip_x1",
          "id": "tip-received",
          "retries": 3,
        },
      }
    `);
  });
});

describe("lane_of", () => {
  test("every kind takes exactly one lane", () => {
    for (const k of KINDS) expect(["money", "notice"]).toContain(lane_of(k));
  });

  // a kind moving lanes changes which queue a failing notification can hold up
  test("money is the kinds that move funds or stop a charge", () => {
    expect(KINDS.filter((k) => lane_of(k) === "money").sort()).toEqual([
      "connect-transfer",
      "don-sttl-dist",
      "paypal-order-capture",
      "sub-deactivated",
    ]);
  });
});
