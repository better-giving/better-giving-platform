import { PayPalApiError } from "@better-giving/paypal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../types";

const create_order_mock = vi.hoisted(() => vi.fn());
const create_subscription_mock = vi.hoisted(() => vi.fn());
const donation_put_mock = vi.hoisted(() => vi.fn());
const donation_update_mock = vi.hoisted(() => vi.fn());

vi.mock("$/kit/paypal", () => ({
  paypal: {
    create_order: create_order_mock,
    create_subscription: create_subscription_mock,
  },
}));
// weekly unset: a deploy missing one plan var
const paypal_env = vi.hoisted(() => ({
  plans: {
    monthly: '{"USD":"P-MONTHLY-USD"}',
    weekly: undefined,
    annual: '{"USD":"P-ANNUAL-USD"}',
  },
}));
vi.mock("$/env", () => ({ paypal: paypal_env }));
const upusd = vi.hoisted(() => ({ v: 1 }));
vi.mock("#/.server/unit-per-usd", () => ({
  unit_per_usd: async () => upusd.v,
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/pg/queries/donation", () => ({
  donation_put: donation_put_mock,
  donation_update: donation_update_mock,
}));

const { paypal_intent } = await import("./index");

const ctx = (patch: Partial<Ctx["intent"]> = {}, via_extra = "") =>
  ({
    to: { to_id: "1", to_type: "npo", to_name: "ACME" },
    from: { from_email: "a@b.co" },
    donor: { email: "a@b.co" },
    via: "paypal",
    via_extra,
    intent: {
      amount: { base: 25, tip: 0, fee_allowance: 0 },
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      ...patch,
    },
  }) as unknown as Ctx;

beforeEach(() => {
  vi.clearAllMocks();
  upusd.v = 1;
  donation_put_mock.mockImplementation(async (_db: unknown, r: unknown) => r);
  donation_update_mock.mockResolvedValue({});
  create_order_mock.mockResolvedValue({ id: "ORDER-1" });
});

describe("paypal_intent currency", () => {
  it("answers a currency paypal can't take with a 400, writing nothing", async () => {
    const res = (await paypal_intent(ctx({ currency: "NGN" }))) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(donation_put_mock).not.toHaveBeenCalled();
    expect(create_order_mock).not.toHaveBeenCalled();
  });
});

describe("paypal_intent minimum", () => {
  it("checks the minimum against the amount paypal is charged", async () => {
    // 2.3 JPY at 1.1/usd is 2.09 usd; the charged 2 is 1.81
    upusd.v = 1.1;
    const res = (await paypal_intent(
      ctx({ currency: "JPY", amount: { base: 2.3, tip: 0, fee_allowance: 0 } })
    )) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    // the refusal marker is what lets `json_ok` show the donor this sentence
    expect(res.headers.get("content-type")).toBe("text/plain");
    await expect(res.text()).resolves.toBe(
      "The minimum PayPal donation is 2 USD, or its equivalent in JPY."
    );
    expect(donation_put_mock).not.toHaveBeenCalled();
  });

  it("names the minimum in usd alone for a usd gift", async () => {
    const res = (await paypal_intent(
      ctx({ amount: { base: 1.5, tip: 0, fee_allowance: 0 } })
    )) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    await expect(res.text()).resolves.toBe(
      "The minimum PayPal donation is 2 USD."
    );
  });
});

describe("paypal_intent refusals name the method", () => {
  it.each([
    ["", "PayPal"],
    ["venmo", "Venmo"],
  ])("via_extra %j: %s", async (via_extra, method) => {
    const currency = (await paypal_intent(
      ctx({ currency: "NGN" }, via_extra)
    )) as Response;
    const minimum = (await paypal_intent(
      ctx({ amount: { base: 1.5, tip: 0, fee_allowance: 0 } }, via_extra)
    )) as Response;

    await expect(currency.text()).resolves.toBe(
      `${method} doesn't accept NGN. Try another payment method.`
    );
    await expect(minimum.text()).resolves.toBe(
      `The minimum ${method} donation is 2 USD.`
    );
  });
});

describe("paypal_intent charged total", () => {
  it.each([
    [
      "USD",
      { base: 25, tip: 0.004, fee_allowance: 1.039 },
      { base: 25, tip: 0, fee_allowance: 1.03 },
      "26.03",
    ],
    [
      "JPY",
      { base: 1500.5, tip: 75.9, fee_allowance: 45.2 },
      { base: 1500, tip: 75, fee_allowance: 45 },
      "1620",
    ],
  ])(
    "%s: the row and the answer carry what paypal is asked for",
    async (currency, amount, row, total) => {
      const res = await paypal_intent(ctx({ currency, amount }));

      expect(donation_put_mock.mock.calls[0]![1].amount).toEqual(row);
      expect(
        create_order_mock.mock.calls[0]![0].purchase_units[0].amount.value
      ).toBe(total);
      expect(res).toMatchObject({ body: { amount: total } });
    }
  );
});

// custom_id is what the capture guard and every webhook route back by
describe("paypal_intent binds paypal's object to the donation", () => {
  it("sets the order's custom_id to the donation id", async () => {
    await paypal_intent(ctx());

    const { id } = donation_put_mock.mock.calls[0]![1];
    expect(
      create_order_mock.mock.calls[0]![0].purchase_units[0].custom_id
    ).toBe(id);
  });

  it("sets the subscription's custom_id to the donation id", async () => {
    create_subscription_mock.mockResolvedValue({ id: "I-SUB1" });

    await paypal_intent(ctx({ frequency: "monthly" }));

    const { id } = donation_put_mock.mock.calls[0]![1];
    expect(create_subscription_mock.mock.calls[0]![0].custom_id).toBe(id);
  });
});

describe("paypal_intent recurring", () => {
  beforeEach(() => {
    create_subscription_mock.mockResolvedValue({ id: "I-SUB1" });
  });

  it("bills each cycle the gift's exact total", async () => {
    const res = await paypal_intent(
      ctx({
        frequency: "monthly",
        amount: { base: 25, tip: 0, fee_allowance: 1.04 },
      })
    );

    const [req, request_id] = create_subscription_mock.mock.calls[0]!;
    expect(req).toMatchObject({ plan_id: "P-MONTHLY-USD", quantity: "26.04" });
    expect(request_id).toBe(`subs-${donation_put_mock.mock.calls[0]![1].id}`);
    expect(res).toMatchObject({ body: { tx_id: "I-SUB1", amount: "26.04" } });
  });

  it("refuses a per-cycle total over paypal's quantity ceiling before any row or subscription exists", async () => {
    const res = (await paypal_intent(
      ctx({
        frequency: "monthly",
        amount: { base: 100000, tip: 0, fee_allowance: 0 },
      })
    )) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    await expect(res.text()).resolves.toBe(
      "We couldn't process this donation. Please refresh the page and try again."
    );
    expect(donation_put_mock).not.toHaveBeenCalled();
    expect(create_subscription_mock).not.toHaveBeenCalled();
  });

  it("sends the largest total paypal takes as a plain decimal string", async () => {
    await paypal_intent(
      ctx({
        frequency: "monthly",
        amount: { base: 99999, tip: 0, fee_allowance: 0.99 },
      })
    );

    expect(create_subscription_mock.mock.calls[0]![0].quantity).toBe(
      "99999.99"
    );
  });

  it("fails only the frequency whose plan env is unset", async () => {
    await expect(paypal_intent(ctx({ frequency: "weekly" }))).rejects.toThrow(
      "weekly"
    );

    expect(create_subscription_mock).not.toHaveBeenCalled();
    expect(donation_update_mock.mock.calls[0]![2]).toEqual({
      status: "failed",
    });
  });
});

describe("paypal_intent when paypal refuses the order", () => {
  it("marks the donation failed and rethrows", async () => {
    const refused = new PayPalApiError(
      "create order",
      422,
      '{"name":"UNPROCESSABLE_ENTITY"}'
    );
    create_order_mock.mockRejectedValue(refused);

    await expect(paypal_intent(ctx())).rejects.toBe(refused);

    const don_id = donation_put_mock.mock.calls[0]![1].id;
    expect(donation_update_mock).toHaveBeenCalledExactlyOnceWith(
      {},
      don_id,
      expect.objectContaining({ status: "failed" })
    );
  });

  it("leaves a donation paypal took the order for as created", async () => {
    const res = await paypal_intent(ctx());

    expect(res).toMatchObject({ body: { tx_id: "ORDER-1" } });
    expect(donation_put_mock.mock.calls[0]![1].status).toBe("created");
    expect(donation_update_mock).not.toHaveBeenCalled();
  });
});
