import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type HttpError, json_ok } from "@/helpers/https";
import {
  create_invoice,
  create_payment,
  estimate_price,
  min_amount,
  with_decimal_strings,
} from "@/nowpayments/fixtures/examples";
import { simple_price_for } from "$/kit/fixtures/coingecko-examples";
import type { TestDb } from "$/pg/test-utils/pglite";
import type { Ctx } from "../types";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const env_mock = vi.hoisted(() => ({
  base_url: "https://app.test",
  stage: "staging",
  nowpayments: {
    api_key: "k",
    api_url: "https://api-sandbox.nowpayments.io",
    is_sandbox: true,
    ipn_secret: "s",
  },
}));

vi.mock("$/env", () => env_mock);
vi.mock("#/errors/report", () => ({
  report_error: vi.fn(),
  report_null: () => null,
}));
vi.mock("$/kit/slack", () => ({
  aws_monitor: { send_alert: vi.fn(async () => new Response()) },
}));
vi.mock("$/kit/coingecko", () => ({ coingecko: vi.fn() }));
vi.mock("$/pg/db", () => ({
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

const { crypto_intent } = await import("./index");
const { coingecko } = await import("$/kit/coingecko");
const { loader: estimate_loader } = await import(
  "#/routes/api.tokens.$code.estimate"
);
const { donations, donation_donors, donation_recipients } = await import(
  "$/pg/schema/donation"
);
const { npos } = await import("$/pg/schema/npo");
const { create_test_db } = await import("$/pg/test-utils/pglite");

const db = () => test_db.current!.db;
const rows = () => db().select().from(donations);

let npo_id: number;

const ctx = (o: Partial<Ctx["intent"]> = {}): Ctx =>
  ({
    to: {
      to_id: npo_id.toString(),
      to_type: "npo",
      to_name: "NP Test NPO",
      to_tip_allowed: false,
      to_members: [],
    },
    from: { from_email: "donor@test.com", from_name: "Jane Donor" },
    donor: { first_name: "Jane", last_name: "Donor", email: "donor@test.com" },
    via: "crypto",
    via_extra: "",
    intent: {
      amount: { base: 1, tip: 0, fee_allowance: 0 },
      currency: "ETH",
      source: "bg-marketplace",
      frequency: "one-time",
      ...o,
    },
  }) as Ctx;

const fetch_spy = () => vi.spyOn(globalThis, "fetch");

type Route = (req: Request) => Response | Promise<Response>;
/** nowpayments by path, answering with the published examples */
const np_server = (o: Record<string, Route> = {}) => {
  const routes: Record<string, Route> = {
    "/v1/min-amount": () => Response.json(min_amount),
    "/v1/estimate": () => Response.json(estimate_price),
    "/v1/invoice": () => Response.json(create_invoice),
    "/v1/invoice-payment": () => Response.json(create_payment),
    ...o,
  };
  return fetch_spy().mockImplementation(async (input) => {
    const req = input as Request;
    const route = routes[new URL(req.url).pathname];
    if (!route) throw new Error(`unexpected nowpayments call ${req.url}`);
    return route(req);
  });
};
const bodies = (spy: ReturnType<typeof fetch_spy>, path: string) =>
  Promise.all(
    spy.mock.calls
      .map(([r]) => r as Request)
      .filter((r) => new URL(r.url).pathname === path)
      .map((r) => r.clone().json())
  );

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db().delete(donation_donors);
  await db().delete(donation_recipients);
  await db().delete(donations);
  await db().delete(npos);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-NP-INTENT",
      name: "NP Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      active: true,
      fiscal_sponsored: true,
      hide_bg_tip: true,
      allocation: { liq: 50, lock: 30, cash: 20 },
      target_smart: true,
    })
    .returning();
  npo_id = npo.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// what the checkout shows the donor: only a marked refusal's body; any other
// failure's `HTTP <status>` is never for their eyes
const shown = (res: unknown) =>
  json_ok(res as Response).then(
    () => "",
    (e: HttpError) => (e.refused ? e.message : "")
  );

const quote_coingecko = () =>
  vi
    .mocked(coingecko)
    .mockImplementationOnce(async () =>
      Response.json(simple_price_for("karate-combat"))
    );

describe("crypto_intent", () => {
  it("an unknown currency is refused and leaves no donation", async () => {
    const res = await crypto_intent(ctx({ currency: "NOPECOIN" }));

    expect((res as Response).status).toBe(400);
    expect(await shown(res)).toMatch(/isn't supported.*different currency/);
    expect(await rows()).toHaveLength(0);
  });

  it.each([400, 404])(
    "a nowpayments %i tells the donor to pick another currency and leaves no donation",
    async (status) => {
      np_server({
        "/v1/invoice": () =>
          new Response('{"message":"currency disabled"}', { status }),
      });
      const res = await crypto_intent(
        ctx({ amount: { base: 0.01, tip: 0, fee_allowance: 0 } })
      );

      expect((res as Response).status).toBe(400);
      const msg = await shown(res);
      expect(msg).toMatch(/isn't available right now.*different currency/);
      expect(msg).not.toMatch(/currency disabled/);
      expect(await rows()).toHaveLength(0);
    }
  );

  it.each([
    ["a 5xx", () => new Response("", { status: 503 })],
    ["a 429", () => new Response("", { status: 429 })],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "%s from nowpayments answers 502 and leaves no donation",
    async (_, route) => {
      np_server({ "/v1/invoice": route });
      const res = await crypto_intent(
        ctx({ amount: { base: 0.01, tip: 0, fee_allowance: 0 } })
      );

      expect((res as Response).status).toBe(502);
      expect(await shown(res)).toBe("");
      expect(await rows()).toHaveLength(0);
    }
  );

  it.each([
    [
      "a zero minimum",
      "/v1/min-amount",
      { ...min_amount, min_amount: 0, fiat_equivalent: 0 },
    ],
    [
      "a null minimum",
      "/v1/min-amount",
      { ...min_amount, min_amount: null, fiat_equivalent: 0 },
    ],
    [
      "a zero estimate",
      "/v1/estimate",
      { ...estimate_price, estimated_amount: 0 },
    ],
  ] as const)(
    "%s tells the donor the currency isn't available and leaves no donation",
    async (_, path, body) => {
      np_server({ [path]: () => Response.json(body) });
      const res = await crypto_intent(
        ctx({ amount: { base: 0.01, tip: 0, fee_allowance: 0 } })
      );

      expect((res as Response).status).toBe(400);
      expect(await shown(res)).toMatch(
        /isn't available right now.*different currency/
      );
      expect(await rows()).toHaveLength(0);
    }
  );

  it("a documented quote prices the invoice and returns the payment", async () => {
    const spy = np_server();
    const res = await crypto_intent(
      ctx({ amount: { base: 0.01, tip: 0, fee_allowance: 0 } })
    );

    expect(res).not.toBeInstanceOf(Response);
    const [invoice] = await bodies(spy, "/v1/invoice");
    // 0.01 BTC at the documented 3999.5 / 0.17061637 dollars per coin
    expect(invoice.price_amount).toBe(234.41478681090214);
    const [row] = await rows();
    expect(row.id).toBe(invoice.order_id);
    expect(row.via_extra).toBe("5745459419");
    // ETH stays ETH at its quoted rate, never usdc at 1
    expect(row.currency).toBe("ETH");
    expect(row.upusd).not.toBe(1);
    expect(row.upusd).toBeCloseTo(0.17061637 / 3999.5, 12);
    expect(res).toMatchObject({
      don_id: invoice.order_id,
      body: {
        id: "5745459419",
        address: "3EZ2uTdVDAMFXTfc6uLDDKR6o8qKBZXVkj",
        amount: 0.17070286,
      },
    });
  });

  it("a USDC intent is valued at a dollar a unit and charged at the quoted rate", async () => {
    const spy = np_server({
      "/v1/min-amount": () =>
        Response.json({ ...min_amount, min_amount: 1, fiat_equivalent: 1.03 }),
      "/v1/estimate": () =>
        Response.json({
          ...estimate_price,
          amount_from: 103,
          estimated_amount: 100,
        }),
      "/v1/invoice-payment": () =>
        Response.json({
          ...create_payment,
          payment_id: "779",
          pay_amount: 10,
          pay_currency: "usdc",
        }),
    });
    const res = await crypto_intent(
      ctx({ currency: "USDC", amount: { base: 10, tip: 0, fee_allowance: 0 } })
    );

    expect(res).not.toBeInstanceOf(Response);
    const [invoice] = await bodies(spy, "/v1/invoice");
    expect(invoice.price_amount).toBe(10.3);
    const [row] = await rows();
    expect(row.upusd).toBe(1);
    expect(res).toMatchObject({ body: { usdpu: 1 } });
  });

  it("a deposit under the pair floor is refused and leaves no donation", async () => {
    np_server({
      "/v1/invoice-payment": () =>
        Response.json({ ...create_payment, pay_amount: 0.00394995 }),
    });
    const res = await crypto_intent(
      ctx({ amount: { base: 0.008136897, tip: 0, fee_allowance: 0 } })
    );

    expect((res as Response).status).toBe(400);
    expect(await shown(res)).toBe(
      "This amount is below the minimum of 0.008136897 ETH. Try a larger amount or a different currency."
    );
    expect(await rows()).toHaveLength(0);
  });

  it("a documented quote sent as decimal strings prices the token", async () => {
    np_server({
      "/v1/estimate": () =>
        Response.json(
          with_decimal_strings(estimate_price, [
            "amount_from",
            "estimated_amount",
          ])
        ),
      "/v1/min-amount": () =>
        Response.json(
          with_decimal_strings(min_amount, ["min_amount", "fiat_equivalent"])
        ),
    });
    const quoted = await estimate_loader({ params: { code: "ETH" } } as any);

    expect(await (quoted as Response).json()).toEqual({
      min: 0.008136897,
      usdpu: 23441.478681090215,
    });
  });

  it("an amount under the quoted minimum is refused and the quoted minimum is accepted", async () => {
    np_server();

    const under = await crypto_intent(
      ctx({ amount: { base: 0.008, tip: 0, fee_allowance: 0 } })
    );
    expect((under as Response).status).toBe(400);
    expect(await shown(under)).toBe(
      "This amount is below the minimum of 0.008136897 ETH. Try a larger amount or a different currency."
    );
    expect(await rows()).toHaveLength(0);

    const at = await crypto_intent(
      ctx({ amount: { base: 0.008136897, tip: 0, fee_allowance: 0 } })
    );
    expect(at).not.toBeInstanceOf(Response);
    expect(await rows()).toHaveLength(1);
  });

  it("a custom token's published price is the estimate", async () => {
    quote_coingecko();
    const quoted = await estimate_loader({
      params: { code: "KARATE-1" },
    } as any);

    // simple/price example: bitcoin.usd is 76975, so a dollar buys 1/76975
    expect(await (quoted as Response).json()).toEqual({
      min: 0.000012991230919129587,
      usdpu: 76975,
    });
  });

  it("a custom token under a dollar is refused and leaves no donation", async () => {
    quote_coingecko();
    const res = await crypto_intent(
      ctx({
        currency: "KARATE-1",
        amount: { base: 0.000006, tip: 0, fee_allowance: 0 },
      })
    );

    expect((res as Response).status).toBe(400);
    expect(await shown(res)).toBe(
      "This amount is below the minimum of 0.000012991230919129587 KARATE-1. Try a larger amount or a different currency."
    );
    expect(await rows()).toHaveLength(0);
  });
});
