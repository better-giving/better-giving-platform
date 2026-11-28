import { createHmac } from "node:crypto";
import type { Grant } from "@better-giving/chariot";
import { afterEach, describe, expect, it, vi } from "vitest";

const get_grant_mock = vi.hoisted(() => vi.fn());
const donation_mocks = vi.hoisted(() => ({
  get: vi.fn(),
  locked: vi.fn(),
  update: vi.fn(),
}));
const send_alert_mock = vi.hoisted(() => vi.fn(async () => {}));
const report_error_mock = vi.hoisted(() => vi.fn());
const report_resp_mock = vi.hoisted(() =>
  vi.fn((e: any) => new Response(e?.message ?? "error", { status: 500 }))
);
const enqueue_mock = vi.hoisted(() => vi.fn());
const has_dists_mock = vi.hoisted(() => vi.fn());
const partner_grant_mock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("$/env", () => ({
  chariot: { signing_key: "whsec-test" },
  stage: "test",
}));
vi.mock("$/kit/chariot", () => ({ chariot: { get_grant: get_grant_mock } }));
vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));
vi.mock("$/kit/slack", () => ({
  aws_monitor: { send_alert: send_alert_mock },
}));
vi.mock("$/pg/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock("$/pg/queries/donation", () => ({
  donation_get: donation_mocks.get,
  donation_settle_state_locked: donation_mocks.locked,
  donation_update: donation_mocks.update,
}));
vi.mock("$/pg/queries/dist", () => ({ donation_has_dists: has_dists_mock }));
vi.mock("$/partner/grant-donation", () => ({
  partner_donation_of_grant: partner_grant_mock,
}));
vi.mock("#/errors/report", () => ({
  report_error: report_error_mock,
  report_resp: report_resp_mock,
}));

const { action } = await import("./api.chariot-webhook");

const T = "2026-09-23T00:00:00.000Z";
const sign = (body: string, secret = "whsec-test") =>
  createHmac("sha256", secret).update(`${T}.${body}`).digest("hex");

const post = (body: string, signature?: string) =>
  action({
    request: new Request("https://x/api/chariot-webhook", {
      method: "POST",
      body,
      headers: signature ? { "chariot-webhook-signature": signature } : {},
    }),
  } as any) as Promise<Response>;

const deliver = (ev: Record<string, unknown>) => {
  const body = JSON.stringify(ev);
  return post(body, `t=${T},v1=${sign(body)}`);
};

afterEach(() => {
  vi.restoreAllMocks();
  get_grant_mock.mockReset();
  donation_mocks.get.mockReset();
  donation_mocks.locked.mockReset();
  donation_mocks.update.mockReset();
  send_alert_mock.mockReset();
  report_error_mock.mockReset();
  report_resp_mock.mockClear();
  enqueue_mock.mockReset();
  has_dists_mock.mockReset();
  partner_grant_mock.mockReset();
  partner_grant_mock.mockResolvedValue(null);
});

const minutes_ago = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

const quiet_console = () =>
  (["log", "info", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {})
  );

const alert_body = () =>
  (send_alert_mock.mock.calls as unknown as [{ body: string }][])[0]![0].body;

const donor = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "555-0100",
  address: { line1: "1 Main St", city: "Town" },
};
const pii = ["Ada", "Lovelace", "ada@example.com", "555-0100", "1 Main St"];

/** what the intent route records on the row a grant made */
const recorded_by = (grant_id: string) => ({
  via: "chariot",
  via_extra: grant_id,
});

describe("chariot webhook logging", () => {
  it.each([
    ["Initiated", 203],
    ["Canceled", 202],
    ["Completed", 200],
  ])(
    "%s grant logs event, grant id and status — no donor data",
    async (status, code) => {
      const spies = quiet_console();
      get_grant_mock.mockResolvedValue({
        id: "grant-1",
        status,
        amount: 10_000,
        feeDetail: { total: 300 },
        metadata: { don_id: "don-1" },
        ...donor,
      });
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-1"),
        id: "don-1",
        status: "intent",
        donor_email: donor.email,
        donor_first_name: donor.firstName,
      });
      donation_mocks.locked.mockResolvedValue({ status: "intent" });
      donation_mocks.update.mockResolvedValue({ id: "don-1" });

      const res = await deliver({
        id: "ev-1",
        category: "grant.updated",
        associated_object_type: "grant",
        associated_object_id: "grant-1",
      });

      expect(res.status).toBe(code);
      const logged = spies.flatMap((s) => s.mock.calls.flat());
      const line = logged.join(" ");
      for (const id of ["ev-1", "grant.updated", "grant-1", status])
        expect(line).toContain(id);
      for (const arg of logged) expect(typeof arg).toBe("string");
      for (const p of pii) expect(line).not.toContain(p);
    }
  );
});

describe("chariot webhook non-grant events", () => {
  it("acks a non-grant event without fetching a grant", async () => {
    const [, info] = quiet_console();
    const res = await deliver({
      id: "ev-2",
      category: "unintegrated_grant.created",
      associated_object_type: "unintegrated_grant",
      associated_object_id: "ug-1",
    });

    expect(res.status).toBeLessThan(300);
    expect(get_grant_mock).not.toHaveBeenCalled();
    const line = info!.mock.calls.flat().join(" ");
    expect(line).toContain("ev-2");
    expect(line).toContain("unintegrated_grant.created");
    expect(line).toContain("unintegrated_grant");
  });
});

describe("chariot webhook grant fetch", () => {
  it("logs the event id and category before a failed grant fetch", async () => {
    const [, info] = quiet_console();
    get_grant_mock.mockRejectedValue(new Error("Chariot API error: 404"));

    const res = await deliver({
      id: "ev-3",
      category: "grant.updated",
      associated_object_type: "grant",
      associated_object_id: "grant-9",
    });

    expect(res.status).toBe(500);
    const line = info!.mock.calls.flat().join(" ");
    expect(line).toContain("ev-3");
    expect(line).toContain("grant.updated");
  });
});

describe("chariot webhook grant without our metadata", () => {
  it.each([
    ["no metadata", undefined],
    ["metadata without a donation id", { campaign: "x" }],
  ])(
    "acks a grant with %s and reports it, without looking up a donation",
    async (_, metadata) => {
      quiet_console();
      get_grant_mock.mockResolvedValue({
        id: "grant-30",
        status: "Completed",
        amount: 10_000,
        metadata,
      });

      const res = await deliver({
        id: "ev-30",
        category: "grant.updated",
        associated_object_type: "grant",
        associated_object_id: "grant-30",
      });

      expect(res.status).toBe(200);
      expect(donation_mocks.get).not.toHaveBeenCalled();
      expect(report_error_mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ grant_id: "grant-30" })
      );
    }
  );
});

describe("chariot webhook partner grant", () => {
  // a partner's connect element is mounted before any payment exists, so its
  // grant carries no metadata: the payment holds the grant id instead
  const event = {
    id: "ev-pg",
    category: "grant.updated",
    associated_object_type: "grant",
    associated_object_id: "grant-pg",
  };
  const grant = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "grant-pg",
    status,
    amount: 10_000,
    feeDetail: { total: 300 },
    ...extra,
  });
  const held = (status: string) => {
    partner_grant_mock.mockResolvedValue("don-pg" as never);
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-pg"),
      id: "don-pg",
      status,
    });
    donation_mocks.locked.mockResolvedValue({ status });
  };

  it("settles the donation its payment holds", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(grant("Completed"));
    held("intent");

    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(partner_grant_mock).toHaveBeenCalledWith(
      expect.anything(),
      "grant-pg"
    );
    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-pg",
      expect.objectContaining({
        status: "settled",
        settlement: expect.objectContaining({ id: "grant-pg", net: 97 }),
      })
    );
    expect(enqueue_mock).toHaveBeenCalled();
  });

  it("cancels it", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(grant("Canceled"));
    held("intent");

    const res = await deliver(event);

    expect(res.status).toBe(202);
    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-pg",
      { status: "cancelled" }
    );
  });

  it("leaves a grant still in progress for the next event", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(grant("Initiated"));
    held("intent");

    expect((await deliver(event)).status).toBe(203);
    expect(donation_mocks.update).not.toHaveBeenCalled();
  });

  it("asks for redelivery when a young grant has no payment row yet", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(
      grant("Completed", { createdAt: minutes_ago(1) })
    );

    const res = await deliver(event);

    expect(res.status).toBe(409);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(report_error_mock).not.toHaveBeenCalled();
  });

  it("acks and reports an old grant no payment holds", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(
      grant("Completed", { createdAt: minutes_ago(61) })
    );

    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ grant_id: "grant-pg" })
    );
  });

  it("a checkout grant no payment holds is handled by its metadata, as before", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(
      grant("Completed", { metadata: { don_id: "don-1" } })
    );
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-pg"),
      id: "don-1",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    expect((await deliver(event)).status).toBe(200);
    expect(donation_mocks.get).toHaveBeenCalledWith("don-1");
  });

  it("the payment's donation wins over metadata the partner's page wrote", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(
      grant("Completed", { metadata: { don_id: "junk" } })
    );
    held("intent");

    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(donation_mocks.get).toHaveBeenCalledWith("don-pg");
    expect(donation_mocks.get).not.toHaveBeenCalledWith("junk");
  });
});

describe("chariot webhook signature header", () => {
  const body = JSON.stringify({
    id: "ev-4",
    category: "grant.updated",
    associated_object_type: "grant",
    associated_object_id: "grant-4",
  });

  it.each([
    ["no header", undefined],
    ["no timestamp", `v1=${sign(body)}`],
    ["only a non-v1 scheme", `t=${T},v0=${sign(body)}`],
  ])("refuses %s with a 400", async (_, header) => {
    quiet_console();
    const res = await post(body, header);

    expect(res.status).toBe(400);
    expect(get_grant_mock).not.toHaveBeenCalled();
  });

  it("accepts a single valid signature", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      id: "grant-4",
      status: "Initiated",
      metadata: { don_id: "don-4" },
    });

    const res = await post(body, `t=${T},v1=${sign(body)}`);

    expect(get_grant_mock).toHaveBeenCalledWith("grant-4");
    expect(res.status).toBe(203);
  });

  it("accepts a valid signature written in uppercase hex", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      id: "grant-4",
      status: "Initiated",
      metadata: { don_id: "don-4" },
    });

    const res = await post(body, `t=${T},v1=${sign(body).toUpperCase()}`);

    expect(get_grant_mock).toHaveBeenCalledWith("grant-4");
    expect(res.status).toBe(203);
  });

  it.each([
    ["a wrong signature", sign(body, "whsec-other")],
    ["a wrong-length signature", sign(body).slice(0, 10)],
  ])("rejects %s with a 401, warning without the body", async (_, v1) => {
    const [, , warn] = quiet_console();
    const res = await post(body, `t=${T},v1=${v1}`);

    expect(res.status).toBe(401);
    expect(get_grant_mock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    const line = warn!.mock.calls.flat().join(" ");
    expect(line).toContain(T);
    expect(line).toContain("1 v1");
    expect(line).not.toContain("ev-4");
    expect(line).not.toContain(v1);
  });

  const other = `v1=${sign(body, "whsec-other")}`;
  const valid = `v1=${sign(body)}`;
  it.each([
    ["first", `${valid},${other}`],
    ["last", `${other},${valid}`],
  ])("accepts when the matching v1 comes %s", async (_, sigs) => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      id: "grant-4",
      status: "Initiated",
      metadata: { don_id: "don-4" },
    });

    const res = await post(body, `t=${T},${sigs}`);

    expect(get_grant_mock).toHaveBeenCalledWith("grant-4");
    expect(res.status).toBe(203);
  });
});

describe("chariot webhook canceled grant", () => {
  const cancel_event = {
    id: "ev-5",
    category: "grant.updated",
    associated_object_type: "grant",
    associated_object_id: "grant-5",
  };
  const canceled_grant = (don_id: string) => ({
    id: "grant-5",
    status: "Canceled",
    amount: 10_000,
    metadata: { don_id },
  });

  it.each(["created", "intent", "confirmed"])(
    "cancels a %s donation",
    async (status) => {
      quiet_console();
      get_grant_mock.mockResolvedValue(canceled_grant("don-5"));
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-5"),
        id: "don-5",
        status,
      });
      donation_mocks.locked.mockResolvedValue({ status });
      donation_mocks.update.mockResolvedValue({ id: "don-5" });

      const res = await deliver(cancel_event);

      expect(res.status).toBe(202);
      expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        "don-5",
        { status: "cancelled" }
      );
    }
  );

  it.each(["settled", "refunded", "refunded_loss"])(
    "leaves a %s donation unchanged and alerts for manual handling",
    async (status) => {
      quiet_console();
      get_grant_mock.mockResolvedValue(canceled_grant("don-6"));
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-5"),
        id: "don-6",
        status,
      });
      donation_mocks.locked.mockResolvedValue({ status });

      const res = await deliver(cancel_event);

      expect(res.status).toBeLessThan(300);
      expect(donation_mocks.update).not.toHaveBeenCalled();
      expect(send_alert_mock).toHaveBeenCalledOnce();
      const alert = JSON.stringify(send_alert_mock.mock.calls[0]);
      for (const id of ["don-6", "grant-5", status])
        expect(alert).toContain(id);
      expect(report_error_mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ don_id: "don-6", grant_id: "grant-5" })
      );
    }
  );

  it.each(["cancelled", "expired", "failed"])(
    "acks a %s donation without writing or alerting",
    async (status) => {
      quiet_console();
      get_grant_mock.mockResolvedValue(canceled_grant("don-7"));
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-5"),
        id: "don-7",
        status,
      });
      donation_mocks.locked.mockResolvedValue({ status });

      const res = await deliver(cancel_event);

      expect(res.status).toBeLessThan(300);
      expect(donation_mocks.update).not.toHaveBeenCalled();
      expect(send_alert_mock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["settled", "refund tooling"],
    ["refunded", "platform loss"],
    ["refunded_loss", "platform loss"],
  ])(
    "alert for a %s donation carries amount, recipient and settlement, and says to use the %s",
    async (status, todo) => {
      quiet_console();
      get_grant_mock.mockResolvedValue({
        ...canceled_grant("don-9"),
        ...donor,
      });
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-5"),
        id: "don-9",
        status,
        to_id: "42",
        to_name: "River Trust",
        donor_email: donor.email,
      });
      donation_mocks.locked.mockResolvedValue({ status, sttl_id: "grant-5" });

      await deliver(cancel_event);

      const body = alert_body();
      for (const fact of [
        "100.00 USD",
        "River Trust (42)",
        "grant grant-5",
        "settlement grant-5",
        todo,
      ])
        expect(body).toContain(fact);
      for (const p of pii) expect(body).not.toContain(p);
    }
  );

  it("alerts instead of cancelling when the donation settled after it was first read", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(canceled_grant("don-8"));
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-5"),
      id: "don-8",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "settled" });

    const res = await deliver(cancel_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(send_alert_mock).toHaveBeenCalledOnce();
  });

  it("still acks a settled donation when the slack alert fails", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(canceled_grant("don-10"));
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-5"),
      id: "don-10",
      status: "settled",
    });
    donation_mocks.locked.mockResolvedValue({ status: "settled" });
    const slack_down = new Error("slack 429");
    send_alert_mock.mockRejectedValue(slack_down);

    const res = await deliver(cancel_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(report_error_mock).toHaveBeenCalledWith(
      slack_down,
      expect.anything()
    );
  });

  it("cancels the row it read when the grant carries a legacy id", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(canceled_grant("legacy-11"));
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-5"),
      id: "don-11",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    const res = await deliver(cancel_event);

    expect(res.status).toBe(202);
    expect(donation_mocks.locked).toHaveBeenCalledWith(
      expect.anything(),
      "don-11"
    );
    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-11",
      { status: "cancelled" }
    );
  });

  it("acks a delivery whose donation does not exist and alerts, since no redelivery can create it", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(canceled_grant("don-12"));
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(cancel_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    const body = alert_body();
    for (const fact of ["grant-5", "don-12", "100.00 USD", "not found"])
      expect(body).toContain(fact);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ don_id: "don-12", grant_id: "grant-5" })
    );
  });

  it("refuses a delivery for a young grant whose donation is not yet recorded, so chariot redelivers", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...canceled_grant("don-13"),
      createdAt: minutes_ago(5),
    });
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(cancel_event);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(send_alert_mock).not.toHaveBeenCalled();
    expect(report_error_mock).not.toHaveBeenCalled();
  });

  it("acks and alerts once a grant with no donation is past the hour", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...canceled_grant("don-14"),
      createdAt: minutes_ago(61),
    });
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(cancel_event);

    expect(res.status).toBe(200);
    expect(alert_body()).toContain("don-14");
  });
});

describe("chariot webhook grant naming a donation that isn't its own", () => {
  // `don_id` rides in connect metadata the browser writes, so it can name any row
  const foreign_rows = [
    ["a bank donation", { via: "bank", via_extra: "pi_1" }],
    ["another grant's donation", { via: "chariot", via_extra: "grant-other" }],
  ] as const;

  it.each(
    foreign_rows.flatMap(([what, row]) =>
      (["Completed", "Canceled"] as const).map((s) => [s, what, row] as const)
    )
  )(
    "a %s grant naming %s writes nothing, alerts, and acks",
    async (status, _, row) => {
      quiet_console();
      get_grant_mock.mockResolvedValue({
        id: "grant-40",
        status,
        amount: 10_000,
        feeDetail: { total: 300 },
        metadata: { don_id: "don-40" },
      });
      donation_mocks.get.mockResolvedValue({
        id: "don-40",
        status: "intent",
        to_id: "42",
        to_name: "River Trust",
        ...row,
      });
      donation_mocks.locked.mockResolvedValue({ status: "intent" });

      const res = await deliver({
        id: "ev-40",
        category: "grant.updated",
        associated_object_type: "grant",
        associated_object_id: "grant-40",
      });

      expect(res.status).toBe(200);
      expect(donation_mocks.update).not.toHaveBeenCalled();
      expect(enqueue_mock).not.toHaveBeenCalled();
      const body = alert_body();
      for (const fact of ["grant-40", "don-40", "100.00 USD", row.via_extra])
        expect(body).toContain(fact);
      expect(report_error_mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ don_id: "don-40", grant_id: "grant-40" })
      );
    }
  );
});

describe("chariot webhook completed grant", () => {
  const complete_event = {
    id: "ev-20",
    category: "grant.updated",
    associated_object_type: "grant",
    associated_object_id: "grant-20",
  };
  const completed_grant = {
    id: "grant-20",
    status: "Completed",
    amount: 10_000,
    feeDetail: { total: 300 },
    metadata: { don_id: "don-20" },
  };

  it("settles an intent donation and enqueues its messages", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-20",
      expect.objectContaining({
        status: "settled",
        settlement: expect.objectContaining({
          id: "grant-20",
          net: 97,
          fee: 3,
        }),
      })
    );
    expect(enqueue_mock.mock.calls.flat().map((m) => m.id)).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
  });

  it("dates the settlement when the grant completed, not when the event is processed", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...completed_grant,
      updatedAt: "2026-09-05T00:00:00Z",
      statuses: [
        { id: "s1", status: "Initiated", createdAt: "2026-08-01T10:00:00Z" },
        { id: "s2", status: "Completed", createdAt: "2026-09-01T12:30:00Z" },
      ],
    });
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    await deliver(complete_event);

    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-20",
      expect.objectContaining({
        settlement: expect.objectContaining({
          date: "2026-09-01T12:30:00.000Z",
        }),
      })
    );
  });

  describe("which status entry dates the settlement", () => {
    const settled_date = async (
      grant: Pick<Grant, "updatedAt" | "statuses">
    ) => {
      quiet_console();
      get_grant_mock.mockResolvedValue({ ...completed_grant, ...grant });
      donation_mocks.get.mockResolvedValue({
        ...recorded_by("grant-20"),
        id: "don-20",
        status: "intent",
      });
      donation_mocks.locked.mockResolvedValue({ status: "intent" });

      await deliver(complete_event);

      return donation_mocks.update.mock.calls[0]![2].settlement.date;
    };

    it("takes the latest Completed entry of a grant that completed more than once, whatever follows it", async () => {
      const date = await settled_date({
        updatedAt: "2026-09-09T00:00:00Z",
        statuses: [
          { id: "s1", status: "Initiated", createdAt: "2026-08-30T09:00:00Z" },
          { id: "s2", status: "Completed", createdAt: "2026-09-01T10:00:00Z" },
          { id: "s3", status: "Canceled", createdAt: "2026-09-02T11:00:00Z" },
          { id: "s4", status: "Completed", createdAt: "2026-09-03T08:00:00Z" },
        ],
      });

      expect(date).toBe("2026-09-03T08:00:00.000Z");
    });

    it("takes the latest Completed entry by its own date, not by its place in the list", async () => {
      const date = await settled_date({
        updatedAt: "2026-09-09T00:00:00Z",
        statuses: [
          { id: "s4", status: "Completed", createdAt: "2026-09-03T08:00:00Z" },
          { id: "s1", status: "Initiated", createdAt: "2026-08-30T09:00:00Z" },
          { id: "s3", status: "Canceled", createdAt: "2026-09-02T11:00:00Z" },
          { id: "s2", status: "Completed", createdAt: "2026-09-01T10:00:00Z" },
        ],
      });

      expect(date).toBe("2026-09-03T08:00:00.000Z");
    });

    it("falls back to when the grant was last updated when no entry says Completed", async () => {
      const date = await settled_date({
        updatedAt: "2026-09-05T00:00:00Z",
        statuses: [
          { id: "s1", status: "Initiated", createdAt: "2026-08-01T10:00:00Z" },
        ],
      });

      expect(date).toBe("2026-09-05T00:00:00.000Z");
    });

    it("falls back to when the grant was last updated when it carries no statuses", async () => {
      const date = await settled_date({
        updatedAt: "2026-09-05T00:00:00Z",
        statuses: undefined,
      });

      expect(date).toBe("2026-09-05T00:00:00.000Z");
    });
  });

  it("splits the fee by who charged it", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...completed_grant,
      feeDetail: {
        total: 450,
        contributions: [
          { name: "Chariot", amount: 300, feeType: "chariot" },
          { name: "Fidelity", amount: 150, feeType: "daf" },
        ],
      },
    });
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    await deliver(complete_event);

    expect(donation_mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "don-20",
      expect.objectContaining({
        settlement: expect.objectContaining({
          fee: 4.5,
          fee_parts: { chariot: 3, daf: 1.5 },
        }),
      })
    );
  });

  it("books a fee entry with no fee type as other", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...completed_grant,
      feeDetail: {
        total: 400,
        contributions: [
          { name: "Chariot", amount: 300, feeType: "chariot" },
          { name: "Unlabelled", amount: 100 },
        ],
      },
    });
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    await deliver(complete_event);

    const [, , patch] = donation_mocks.update.mock.calls[0];
    expect(patch.settlement.fee_parts).toEqual({ chariot: 3, other: 1 });
  });

  const settle_with_fees = async (feeDetail: unknown) => {
    quiet_console();
    get_grant_mock.mockResolvedValue({ ...completed_grant, feeDetail });
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });
    await deliver(complete_event);
    const [, , patch] = donation_mocks.update.mock.calls[0];
    return patch.settlement;
  };

  it("sums fee entries of the same type", async () => {
    const settlement = await settle_with_fees({
      total: 450,
      contributions: [
        { name: "Chariot", amount: 300, feeType: "chariot" },
        { name: "Chariot", amount: 150, feeType: "chariot" },
      ],
    });
    expect(settlement.fee_parts).toEqual({ chariot: 4.5 });
  });

  it("takes the fee from its entries when the grant has no total", async () => {
    const settlement = await settle_with_fees({
      contributions: [
        { name: "Chariot", amount: 300, feeType: "chariot" },
        { name: "Fidelity", amount: 150, feeType: "daf" },
      ],
    });
    expect(settlement).toMatchObject({
      fee: 4.5,
      net: 95.5,
      fee_parts: { chariot: 3, daf: 1.5 },
    });
  });

  it("books what the entries leave of the total as other", async () => {
    const settlement = await settle_with_fees({
      total: 500,
      contributions: [
        { name: "Chariot", amount: 300, feeType: "chariot" },
        { name: "Fidelity", amount: 150, feeType: "daf" },
      ],
    });
    expect(settlement).toMatchObject({
      fee: 5,
      net: 95,
      fee_parts: { chariot: 3, daf: 1.5, other: 0.5 },
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("grant-20")
    );
  });

  const in_cents = (dollars: number) => Math.round(dollars * 100);
  const parts_in_cents = (parts: Record<string, number>) =>
    Object.values(parts).reduce((sum, d) => sum + in_cents(d), 0);

  it("splits a fee whose parts aren't float-clean exactly", async () => {
    const settlement = await settle_with_fees({
      total: 33,
      contributions: [
        { name: "Chariot", amount: 10, feeType: "chariot" },
        { name: "Fidelity", amount: 20, feeType: "daf" },
        {
          name: "Better Giving",
          amount: 3,
          feeType: "fundraising_application",
        },
      ],
    });
    expect(settlement.fee_parts).toEqual({
      chariot: 0.1,
      daf: 0.2,
      fundraising_application: 0.03,
    });
    expect(parts_in_cents(settlement.fee_parts)).toBe(33);
    expect(in_cents(settlement.fee)).toBe(33);
  });

  it("rounds fractional-cent parts to cents, the remainder on the largest", async () => {
    const settlement = await settle_with_fees({
      total: 100,
      contributions: [
        { name: "Chariot", amount: 33.4, feeType: "chariot" },
        { name: "Fidelity", amount: 33.3, feeType: "daf" },
        {
          name: "Better Giving",
          amount: 33.3,
          feeType: "fundraising_application",
        },
      ],
    });
    expect(settlement.fee_parts).toEqual({
      chariot: 0.34,
      daf: 0.33,
      fundraising_application: 0.33,
    });
  });

  it("stores no fee split for a grant without a fee breakdown", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
    });
    donation_mocks.locked.mockResolvedValue({ status: "intent" });

    await deliver(complete_event);

    const [, , patch] = donation_mocks.update.mock.calls[0];
    expect(patch.settlement.fee).toBe(3);
    expect(patch.settlement).not.toHaveProperty("fee_parts");
  });

  it("leaves a cancelled donation unsettled and alerts", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "intent",
      to_id: "42",
      to_name: "River Trust",
    });
    donation_mocks.locked.mockResolvedValue({ status: "cancelled" });

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
    expect(send_alert_mock).toHaveBeenCalledOnce();
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ don_id: "don-20", grant_id: "grant-20" })
    );
  });

  const settled_row = {
    ...recorded_by("grant-20"),
    id: "don-20",
    status: "settled",
    to_id: "42",
    to_name: "River Trust",
    settlement: {
      id: "grant-20",
      date: T,
      net: 97,
      fee: 3,
      currency: "USD",
    },
  };

  it.each([
    [true, ["don-sttl-receipt"]],
    [false, ["don-sttl-dist", "don-sttl-receipt"]],
  ])(
    "redelivery on a settled donation re-sends its messages without settling again (distributed: %s)",
    async (distributed, sent) => {
      quiet_console();
      get_grant_mock.mockResolvedValue(completed_grant);
      donation_mocks.get.mockResolvedValue(settled_row);
      donation_mocks.locked.mockResolvedValue({
        status: "settled",
        sttl_id: "grant-20",
      });
      has_dists_mock.mockResolvedValue(distributed);

      const res = await deliver(complete_event);

      expect(res.status).toBe(200);
      expect(donation_mocks.update).not.toHaveBeenCalled();
      expect(enqueue_mock.mock.calls.flat().map((m) => m.id)).toEqual(sent);
    }
  );

  it("alerts instead of re-sending when the donation was settled by a different grant", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...settled_row,
      settlement: { ...settled_row.settlement, id: "grant-other" },
    });
    donation_mocks.locked.mockResolvedValue({
      status: "settled",
      sttl_id: "grant-other",
    });
    has_dists_mock.mockResolvedValue(false);

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
    expect(send_alert_mock).toHaveBeenCalledOnce();
    const body = alert_body();
    for (const fact of ["grant grant-20", "settlement grant-other", "don-20"])
      expect(body).toContain(fact);
  });

  it("acks a settled donation that has no settlement and alerts, since no redelivery can repair it", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...settled_row,
      settlement: undefined,
    });
    donation_mocks.locked.mockResolvedValue({ status: "settled" });

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    const body = alert_body();
    for (const fact of ["grant-20", "don-20", "100.00 USD", "no settlement"])
      expect(body).toContain(fact);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ don_id: "don-20", grant_id: "grant-20" })
    );
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("does not settle again when a concurrent delivery settled it after the first read", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue({
      ...settled_row,
      status: "intent",
      settlement: undefined,
    });
    donation_mocks.locked.mockResolvedValue({
      status: "settled",
      sttl_id: "grant-20",
    });

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it.each(["refunded", "refunded_loss"])(
    "redelivery on a %s donation neither settles nor re-sends anything",
    async (status) => {
      quiet_console();
      get_grant_mock.mockResolvedValue(completed_grant);
      donation_mocks.get.mockResolvedValue({ ...settled_row, status });
      donation_mocks.locked.mockResolvedValue({ status, sttl_id: "grant-20" });
      has_dists_mock.mockResolvedValue(false);

      const res = await deliver(complete_event);

      expect(res.status).toBe(200);
      expect(donation_mocks.update).not.toHaveBeenCalled();
      expect(enqueue_mock).not.toHaveBeenCalled();
      expect(send_alert_mock).not.toHaveBeenCalled();
    }
  );

  it("acks a completed grant whose donation does not exist and alerts, since no redelivery can create it", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue(completed_grant);
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    const body = alert_body();
    for (const fact of ["grant-20", "don-20", "100.00 USD", "not found"])
      expect(body).toContain(fact);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ don_id: "don-20", grant_id: "grant-20" })
    );
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("refuses a completed grant whose donation is not yet recorded while the grant's first status is young", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({
      ...completed_grant,
      statuses: [
        { id: "s1", status: "Initiated", createdAt: minutes_ago(30) },
        { id: "s2", status: "Completed", createdAt: minutes_ago(1) },
      ],
    });
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(complete_event);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(send_alert_mock).not.toHaveBeenCalled();
    expect(donation_mocks.update).not.toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("ages a grant by its earliest status entry, not by its first in the list", async () => {
    quiet_console();
    const statuses: Grant["statuses"] = [
      { id: "s2", status: "Completed", createdAt: minutes_ago(1) },
      { id: "s1", status: "Initiated", createdAt: minutes_ago(3 * 60) },
    ];
    get_grant_mock.mockResolvedValue({ ...completed_grant, statuses });
    donation_mocks.get.mockResolvedValue(undefined);

    const res = await deliver(complete_event);

    expect(res.status).toBe(200);
    expect(alert_body()).toContain("not found");
  });

  it("alert for a cancelled donation carries the amount and recipient, no donor data", async () => {
    quiet_console();
    get_grant_mock.mockResolvedValue({ ...completed_grant, ...donor });
    donation_mocks.get.mockResolvedValue({
      ...recorded_by("grant-20"),
      id: "don-20",
      status: "cancelled",
      to_id: "42",
      to_name: "River Trust",
      donor_email: donor.email,
    });
    donation_mocks.locked.mockResolvedValue({ status: "cancelled" });

    await deliver(complete_event);

    const body = alert_body();
    for (const fact of [
      "100.00 USD",
      "net 97.00 USD",
      "fee 3.00 USD",
      "River Trust (42)",
      "grant-20",
    ])
      expect(body).toContain(fact);
    for (const p of pii) expect(body).not.toContain(p);
  });
});
