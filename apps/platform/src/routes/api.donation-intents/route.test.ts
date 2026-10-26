import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDonationIntent } from "@/donations/schema";
import type { Ctx, IntentResult } from "./types";

const stripe_intent_mock = vi.hoisted(() => vi.fn());
const paypal_intent_mock = vi.hoisted(() => vi.fn());
const crypto_intent_mock = vi.hoisted(() => vi.fn());
const chariot_intent_mock = vi.hoisted(() => vi.fn());
const capture_order_mock = vi.hoisted(() => vi.fn());
const npo_get_mock = vi.hoisted(() => vi.fn());
const fund_get_mock = vi.hoisted(() => vi.fn());
const npo_program_get_mock = vi.hoisted(() => vi.fn());
const form_get_mock = vi.hoisted(() => vi.fn());
const campaign_by_id_mock = vi.hoisted(() => vi.fn());

vi.mock("./stripe", () => ({ stripe_intent: stripe_intent_mock }));
vi.mock("./paypal", () => ({ paypal_intent: paypal_intent_mock }));
vi.mock("./crypto", () => ({ crypto_intent: crypto_intent_mock }));
vi.mock("./chariot", () => ({ chariot_intent: chariot_intent_mock }));
vi.mock("./paypal/capture-order", () => ({
  capture_order: capture_order_mock,
}));

const cookie_parse_mock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const cookie_serialize_mock = vi.hoisted(() =>
  vi.fn().mockResolvedValue("donations=stub")
);

vi.mock("$/pg/queries/npo", () => ({ npo_get: npo_get_mock }));
vi.mock("$/pg/queries/fund", () => ({ fund_get: fund_get_mock }));
vi.mock("$/pg/queries/program", () => ({
  npo_program_get: npo_program_get_mock,
}));
vi.mock("$/pg/queries/form", () => ({ form_get: form_get_mock }));
vi.mock("$/pg/queries/campaign", () => ({
  campaign_by_id: campaign_by_id_mock,
  campaign_accepts: (
    row: { status: string; ends_at: string | null },
    now: Date
  ) => {
    if (row.status !== "live") return false;
    if (row.ends_at && new Date(row.ends_at).getTime() <= now.getTime()) {
      return false;
    }
    return true;
  },
}));
vi.mock("#/.server/cookie", () => ({
  donations_cookie: {
    parse: cookie_parse_mock,
    serialize: cookie_serialize_mock,
  },
}));

const { action } = await import("./route");

const to_stub = {
  to_id: "1",
  to_type: "npo" as const,
  to_name: "ACME",
  to_tip_allowed: true,
  to_members: [],
};

const npo_row = { name: "ACME", active: true, hide_bg_tip: false };

const valid_body = (via: IDonationIntent["via"]): unknown => ({
  via,
  via_extra: "",
  amount: { base: 100, tip: 0, fee_allowance: 0 },
  currency: "USD",
  to_id: "1",
  donor: { email: "a@b.co" },
  source: "bg-marketplace",
  frequency: "one-time",
});

const post = (body: unknown): Request =>
  new Request("https://x/api/donation-intents", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const invoke = async (request: Request): Promise<Response> =>
  (await action({ request } as any)) as Response;

const ok_result = (
  don_id: string,
  body: Record<string, any>
): IntentResult => ({
  don_id,
  body,
});

beforeEach(() => {
  vi.clearAllMocks();
  npo_get_mock.mockResolvedValue(npo_row);
});

describe("api.donation-intents action", () => {
  it("routes via=card to stripe_intent with ctx.via='card'", async () => {
    stripe_intent_mock.mockResolvedValue(
      ok_result("don-1", { client_secret: "cs", order_id: "don-1" })
    );
    const res = await invoke(post(valid_body("card")));

    expect(stripe_intent_mock).toHaveBeenCalledOnce();
    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.via).toBe("card");
    expect(ctx.to).toEqual(to_stub);
    expect(ctx.donor.email).toBe("a@b.co");

    expect(res!.status).toBe(200);
    // browser fetch forbids reading set-cookie; assert cookie was built with don_id key
    expect(cookie_serialize_mock).toHaveBeenCalledWith(
      expect.objectContaining({ "don-1": expect.any(Number) })
    );
    await expect(res!.json()).resolves.toEqual({
      client_secret: "cs",
      order_id: "don-1",
    });
  });

  it("routes via=bank to stripe_intent with ctx.via='bank'", async () => {
    stripe_intent_mock.mockResolvedValue(ok_result("don-2", { ok: true }));
    await invoke(post(valid_body("bank")));

    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.via).toBe("bank");
    expect(paypal_intent_mock).not.toHaveBeenCalled();
  });

  it("routes via=paypal to paypal_intent", async () => {
    paypal_intent_mock.mockResolvedValue(
      ok_result("don-3", { tx_id: "tx", don_id: "don-3" })
    );
    const res = await invoke(post(valid_body("paypal")));

    expect(paypal_intent_mock).toHaveBeenCalledOnce();
    expect(stripe_intent_mock).not.toHaveBeenCalled();
    await expect(res!.json()).resolves.toEqual({
      tx_id: "tx",
      don_id: "don-3",
    });
  });

  it("routes via=crypto to crypto_intent", async () => {
    crypto_intent_mock.mockResolvedValue(ok_result("don-4", { id: "pay-x" }));
    const res = await invoke(post(valid_body("crypto")));

    expect(crypto_intent_mock).toHaveBeenCalledOnce();
    await expect(res!.json()).resolves.toEqual({ id: "pay-x" });
  });

  it("routes via=chariot to chariot_intent", async () => {
    chariot_intent_mock.mockResolvedValue(ok_result("don-5", { id: "don-5" }));
    const res = await invoke(post(valid_body("chariot")));

    expect(chariot_intent_mock).toHaveBeenCalledOnce();
    await expect(res!.json()).resolves.toEqual({ id: "don-5" });
  });

  // a marked 4xx body is what `json_ok` shows the donor
  it("returns a donor sentence with 404 when recipient not found", async () => {
    npo_get_mock.mockResolvedValueOnce(undefined);
    const res = await invoke(post(valid_body("card")));

    expect(res!.status).toBe(404);
    expect(res!.headers.get("x-refusal")).toBe("1");
    expect(res!.headers.get("content-type")).toBe("text/plain");
    await expect(res!.text()).resolves.toBe(
      "This nonprofit isn't accepting donations right now."
    );
    expect(stripe_intent_mock).not.toHaveBeenCalled();
  });

  describe("fund recipient", () => {
    const fund_id = "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9";
    const fund_row = (o: { active: boolean; expiration: string | null }) => ({
      id: fund_id,
      name: "Relief Fund",
      hide_bg_tip: false,
      members: [7, 9],
      ...o,
    });
    const fund_body = () => ({
      ...(valid_body("card") as object),
      to_id: fund_id,
    });

    it("refuses an expired fund with the campaign 404 and creates no intent", async () => {
      fund_get_mock.mockResolvedValueOnce(
        fund_row({ active: true, expiration: "2020-01-01T00:00:00.000Z" })
      );
      const res = await invoke(post(fund_body()));

      expect(res.status).toBe(404);
      expect(res.headers.get("x-refusal")).toBe("1");
      await expect(res.text()).resolves.toBe(
        "This campaign isn't accepting donations right now."
      );
      expect(stripe_intent_mock).not.toHaveBeenCalled();
      expect(cookie_serialize_mock).not.toHaveBeenCalled();
    });

    it("refuses an inactive fund with the campaign 404", async () => {
      fund_get_mock.mockResolvedValueOnce(
        fund_row({ active: false, expiration: null })
      );
      const res = await invoke(post(fund_body()));

      expect(res.status).toBe(404);
      expect(res.headers.get("x-refusal")).toBe("1");
      await expect(res.text()).resolves.toBe(
        "This campaign isn't accepting donations right now."
      );
      expect(stripe_intent_mock).not.toHaveBeenCalled();
    });

    it("refuses a well-formed uuid naming no fund with the campaign 404", async () => {
      fund_get_mock.mockResolvedValueOnce(undefined);
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const res = await invoke(post(fund_body()));

      expect(res.status).toBe(404);
      expect(res.headers.get("x-refusal")).toBe("1");
      await expect(res.text()).resolves.toBe(
        "This campaign isn't accepting donations right now."
      );
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining(`campaign:${fund_id}`)
      );
      expect(stripe_intent_mock).not.toHaveBeenCalled();
    });

    // a request instant hoisted to module scope would freeze at cold start
    describe("against the request's own clock", () => {
      beforeEach(() => {
        vi.setSystemTime(new Date("2099-06-15T12:00:00.000Z"));
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("refuses a fund whose end date ended everywhere at the request", async () => {
        fund_get_mock.mockResolvedValueOnce(
          fund_row({ active: true, expiration: "2099-06-14T00:00:00.000Z" })
        );
        const res = await invoke(post(fund_body()));

        expect(res.status).toBe(404);
        expect(res.headers.get("x-refusal")).toBe("1");
        expect(stripe_intent_mock).not.toHaveBeenCalled();
      });

      it("accepts a fund whose end date ends everywhere a millisecond after the request", async () => {
        vi.setSystemTime(new Date("2099-06-15T11:59:59.999Z"));
        fund_get_mock.mockResolvedValueOnce(
          fund_row({ active: true, expiration: "2099-06-14T00:00:00.000Z" })
        );
        stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
        const res = await invoke(post(fund_body()));

        expect(res.status).toBe(200);
        expect(stripe_intent_mock).toHaveBeenCalledOnce();
      });
    });

    it.each([
      ["a future expiration", "2999-01-01T00:00:00.000Z"],
      ["no expiration", null],
    ])(
      "creates the intent for an active fund with %s",
      async (_, expiration) => {
        fund_get_mock.mockResolvedValueOnce(
          fund_row({ active: true, expiration })
        );
        stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
        const res = await invoke(post(fund_body()));

        expect(res.status).toBe(200);
        const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
        expect(ctx.to).toEqual({
          to_id: fund_id,
          to_type: "fund",
          to_name: "Relief Fund",
          to_tip_allowed: true,
          to_members: ["7", "9"],
        });
      }
    );
  });

  it("refuses an inactive nonprofit with the not-accepting 404", async () => {
    npo_get_mock.mockResolvedValueOnce({ ...npo_row, active: false });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await invoke(post(valid_body("card")));

    expect(res.status).toBe(404);
    expect(res.headers.get("x-refusal")).toBe("1");
    await expect(res.text()).resolves.toBe(
      "This nonprofit isn't accepting donations right now."
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining("nonprofit:1"));
    expect(stripe_intent_mock).not.toHaveBeenCalled();
  });

  it("returns a donor sentence with 400 when the intent fails the schema", async () => {
    const res = await invoke(
      post({ ...(valid_body("card") as object), to_id: 5 })
    );

    expect(res!.status).toBe(400);
    expect(res!.headers.get("x-refusal")).toBe("1");
    expect(res!.headers.get("content-type")).toBe("text/plain");
    await expect(res!.text()).resolves.toBe(
      "We couldn't process this donation. Please refresh the page and try again."
    );
    expect(stripe_intent_mock).not.toHaveBeenCalled();
  });

  it.each(["POST", "PATCH"])(
    "%s answers a body that isn't json with the donor 400",
    async (method) => {
      const res = await invoke(
        new Request("https://x/api/donation-intents", {
          method,
          body: "not json",
          headers: { "content-type": "application/json" },
        })
      );

      expect(res.status).toBe(400);
      expect(res.headers.get("x-refusal")).toBe("1");
      expect(res.headers.get("content-type")).toBe("text/plain");
      await expect(res.text()).resolves.toBe(
        "We couldn't process this donation. Please refresh the page and try again."
      );
      expect(capture_order_mock).not.toHaveBeenCalled();
      expect(stripe_intent_mock).not.toHaveBeenCalled();
    }
  );

  it("passes provider Response through without cookie wrap", async () => {
    stripe_intent_mock.mockResolvedValue(
      new Response("less than min", { status: 400 })
    );
    const res = await invoke(post(valid_body("card")));

    expect(res!.status).toBe(400);
    expect(cookie_serialize_mock).not.toHaveBeenCalled();
    await expect(res!.text()).resolves.toBe("less than min");
  });

  describe("program attribution", () => {
    const program = {
      id: "0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e",
      name: "Youth",
    };

    it("proceeds unattributed when the program belongs to another npo", async () => {
      npo_program_get_mock.mockResolvedValueOnce(undefined);
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-p", { ok: 1 }));
      const res = await invoke(
        post({ ...(valid_body("card") as object), program })
      );

      expect(res.status).toBe(200);
      expect(npo_program_get_mock).toHaveBeenCalledWith(program.id, 1);
      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.program).toBeUndefined();
    });

    it("names the recipient npo's own program by its stored title, not the request's", async () => {
      npo_program_get_mock.mockResolvedValueOnce({
        id: program.id,
        title: "Youth Literacy",
        milestones: [],
      });
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-p", { ok: 1 }));
      await invoke(
        post({
          ...(valid_body("card") as object),
          program: { id: program.id, name: "Send refunds to me" },
        })
      );

      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.program).toEqual({
        id: program.id,
        name: "Youth Literacy",
      });
    });

    it("drops any program when the recipient is a fund", async () => {
      fund_get_mock.mockResolvedValueOnce({
        id: "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9",
        name: "Relief Fund",
        hide_bg_tip: false,
        members: [7],
        active: true,
        expiration: null,
      });
      npo_program_get_mock.mockResolvedValueOnce({
        id: program.id,
        title: "Youth",
        milestones: [],
      });
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-p", { ok: 1 }));
      const res = await invoke(
        post({
          ...(valid_body("card") as object),
          to_id: "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9",
          program,
        })
      );

      expect(res.status).toBe(200);
      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.program).toBeUndefined();
    });
  });

  describe("form attribution", () => {
    const form_id = "frm-1";
    const form_body = () => ({ ...(valid_body("card") as object), form_id });

    it("drops a form whose recipient is another npo and still creates the intent", async () => {
      form_get_mock.mockResolvedValueOnce({
        id: form_id,
        recipient_npo_id: 2,
        recipient_fund_id: null,
      });
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
      const res = await invoke(post(form_body()));

      expect(res.status).toBe(200);
      expect(form_get_mock).toHaveBeenCalledWith(form_id);
      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.form_id).toBeUndefined();
    });

    it("drops a form id naming no form", async () => {
      form_get_mock.mockResolvedValueOnce(undefined);
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
      await invoke(post(form_body()));

      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.form_id).toBeUndefined();
    });

    it("keeps a form whose recipient is the intent's npo", async () => {
      form_get_mock.mockResolvedValueOnce({
        id: form_id,
        recipient_npo_id: 1,
        recipient_fund_id: null,
      });
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
      await invoke(post(form_body()));

      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.form_id).toBe(form_id);
    });

    it("keeps a form whose recipient is the intent's fund", async () => {
      const fund_id = "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9";
      fund_get_mock.mockResolvedValueOnce({
        id: fund_id,
        name: "Relief Fund",
        hide_bg_tip: false,
        members: [7],
        active: true,
        expiration: null,
      });
      form_get_mock.mockResolvedValueOnce({
        id: form_id,
        recipient_npo_id: null,
        recipient_fund_id: fund_id,
      });
      stripe_intent_mock.mockResolvedValueOnce(ok_result("don-f", { ok: 1 }));
      await invoke(post({ ...form_body(), to_id: fund_id }));

      const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
      expect(ctx.intent.form_id).toBe(form_id);
    });
  });

  it("PATCH calls capture_order and bypasses via dispatch", async () => {
    capture_order_mock.mockResolvedValue({ captured: true });
    const req = new Request("https://x/api/donation-intents", {
      method: "PATCH",
      body: JSON.stringify({ order_id: "o1", don_id: "d1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await invoke(req);

    expect(capture_order_mock).toHaveBeenCalledWith({
      order_id: "o1",
      don_id: "d1",
    });
    expect(stripe_intent_mock).not.toHaveBeenCalled();
    await expect(res!.json()).resolves.toEqual({ captured: true });
  });

  it.each([
    ["numeric order_id", { order_id: 123, don_id: "d1" }],
    ["object order_id", { order_id: { $ne: "" }, don_id: "d1" }],
    ["numeric don_id", { order_id: "o1", don_id: 7 }],
    ["blank don_id", { order_id: "o1", don_id: "  " }],
  ])("PATCH refuses a %s without capturing", async (_, body) => {
    const res = await invoke(
      new Request("https://x/api/donation-intents", {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    await expect(res.text()).resolves.toBe(
      "We couldn't process this donation. Please refresh the page and try again."
    );
    expect(capture_order_mock).not.toHaveBeenCalled();
  });

  it("PATCH returns 400 on missing fields", async () => {
    const req = new Request("https://x/api/donation-intents", {
      method: "PATCH",
      body: JSON.stringify({ order_id: "o1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await invoke(req);

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(res.headers.get("content-type")).toBe("text/plain");
    await expect(res.text()).resolves.toBe(
      "We couldn't process this donation. Please refresh the page and try again."
    );
    expect(capture_order_mock).not.toHaveBeenCalled();
  });

  it("PATCH returns 400 on a json null body", async () => {
    const req = new Request("https://x/api/donation-intents", {
      method: "PATCH",
      body: "null",
      headers: { "content-type": "application/json" },
    });
    const res = await invoke(req);

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(capture_order_mock).not.toHaveBeenCalled();
  });
});

const CAMPAIGN = "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9";
const PROGRAM = "0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e";

describe("campaign attribution", () => {
  const row = (o: {
    status: string;
    ends_at?: string | null;
    owner_npo_id?: number;
    program_id?: string | null;
    program_name?: string | null;
  }) => ({
    id: CAMPAIGN,
    owner_npo_id: o.owner_npo_id ?? 1,
    status: o.status,
    ends_at: o.ends_at ?? null,
    program_id: o.program_id ?? null,
    program_name: o.program_name ?? null,
  });

  const with_campaign = (extra: object = {}) =>
    post({
      ...(valid_body("card") as object),
      campaign_id: CAMPAIGN,
      ...extra,
    });

  it("refuses a draft, an ended campaign, and one past its end", async () => {
    for (const campaign of [
      row({ status: "draft" }),
      row({ status: "ended" }),
      row({ status: "live", ends_at: "2020-01-01T00:00:00.000Z" }),
    ]) {
      campaign_by_id_mock.mockResolvedValueOnce(campaign);
      const res = await invoke(with_campaign());
      expect(res.status).toBe(400);
      await expect(res.text()).resolves.toBe(
        "This campaign isn't accepting donations right now."
      );
    }
    expect(stripe_intent_mock).not.toHaveBeenCalled();
  });

  it("drops a campaign owned by someone else and still takes the gift", async () => {
    campaign_by_id_mock.mockResolvedValueOnce(
      row({ status: "live", owner_npo_id: 99 })
    );
    stripe_intent_mock.mockResolvedValueOnce(ok_result("don-c", { ok: 1 }));
    const res = await invoke(with_campaign());
    expect(res.status).toBe(200);
    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.intent.campaign_id).toBeUndefined();
  });

  it("drops an unknown campaign and still takes the gift", async () => {
    campaign_by_id_mock.mockResolvedValueOnce(undefined);
    stripe_intent_mock.mockResolvedValueOnce(ok_result("don-c", { ok: 1 }));
    const res = await invoke(with_campaign());
    expect(res.status).toBe(200);
    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.intent.campaign_id).toBeUndefined();
  });

  it("uses the campaign program and drops the one on the request", async () => {
    campaign_by_id_mock.mockResolvedValueOnce(
      row({
        status: "live",
        program_id: PROGRAM,
        program_name: "Stored",
      })
    );
    npo_program_get_mock.mockReset();
    npo_program_get_mock.mockResolvedValue({
      id: PROGRAM,
      title: "Youth Literacy",
    });
    stripe_intent_mock.mockResolvedValueOnce(ok_result("don-c", { ok: 1 }));
    await invoke(
      with_campaign({
        program: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Request",
        },
      })
    );
    expect(npo_program_get_mock).toHaveBeenCalledWith(PROGRAM, 1);
    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.intent.campaign_id).toBe(CAMPAIGN);
    expect(ctx.intent.program).toEqual({
      id: PROGRAM,
      name: "Youth Literacy",
    });
  });

  it("gives the gift no program when the campaign has none", async () => {
    campaign_by_id_mock.mockResolvedValueOnce(row({ status: "live" }));
    stripe_intent_mock.mockResolvedValueOnce(ok_result("don-c", { ok: 1 }));
    await invoke(
      with_campaign({
        program: { id: PROGRAM, name: "Request" },
      })
    );
    expect(npo_program_get_mock).not.toHaveBeenCalled();
    const ctx: Ctx = stripe_intent_mock.mock.calls[0]![0];
    expect(ctx.intent.campaign_id).toBe(CAMPAIGN);
    expect(ctx.intent.program).toBeUndefined();
  });
});
