import { ChariotError } from "@better-giving/chariot";
import { PayPalApiError } from "@better-giving/paypal";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const pi_create = vi.hoisted(() => vi.fn());
const create_order = vi.hoisted(() => vi.fn());
const get_order = vi.hoisted(() => vi.fn());
const customer_with_currency = vi.hoisted(() => vi.fn(async () => "cus_1"));
const create_grant = vi.hoisted(() => vi.fn());

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
vi.mock("#/errors/report", () => ({
  report_error: vi.fn(),
  report_degraded: vi.fn(),
}));
vi.mock("$/kit/stripe", () => ({
  stripe: { paymentIntents: { create: pi_create } },
}));
vi.mock("$/kit/paypal", () => ({ paypal: { create_order, get_order } }));
vi.mock("$/kit/chariot", () => ({ chariot: { create_grant } }));
vi.mock("#/.server/unit-per-usd", () => ({ unit_per_usd: async () => 1 }));
vi.mock("#/routes/api.donation-intents/stripe/customer-with-currency", () => ({
  customer_with_currency,
}));
vi.mock("#/routes/api.donation-intents/stripe/descriptor-suffix", () => ({
  npo_descriptor_suffix: async () => undefined,
}));

const { create_test_db } = await import("$/pg/test-utils/pglite");
const { donation_recipients, donations } = await import("$/pg/schema/donation");
const { user } = await import("$/pg/schema/auth");
const { npos } = await import("$/pg/schema/npo");
const { partner_keys, partner_payments, partner_tenants } = await import(
  "$/pg/schema/partner"
);
const { rate_limit_windows } = await import("$/pg/schema/rate-limit");
const { mint_key } = await import("$/partner/keys");
const { DONOR_IP_QUOTA, fingerprint_of } = await import("$/partner/payments");
const { partner_donation_of_grant } = await import("$/partner/grant-donation");
const { action } = await import("./api.partner.v1.payments");
const { loader: read } = await import("./api.partner.v1.payments_.$id");

type Db = Parameters<typeof mint_key>[0];
const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  get_order.mockReset();
  pi_create.mockResolvedValue({ client_secret: "pi_1_secret_x" });
  create_order.mockResolvedValue({ id: "ORDER-1" });
  create_grant.mockImplementation(async () => ({
    id: "grant_1",
    amount: 5000,
    // a partner's connect element carries no metadata: no payment exists yet
  }));
  await db().delete(partner_payments);
  await db().delete(donations);
  await db().delete(rate_limit_windows);
  await db().delete(partner_keys);
  await db().delete(partner_tenants);
  await db().delete(npos);
  await db().delete(user);
});

const seed = async () => {
  const staff = (await seed_user(db(), "ada@test.com"))!;
  const mine = (await seed_npo(db(), {
    registration_number: "EIN-MINE",
    donate_methods: ["stripe", "stripe_bank", "daf"],
  }))!;
  const theirs = (await seed_npo(db(), {
    registration_number: "EIN-THEM",
    donate_methods: ["stripe"],
  }))!;
  const mint = (npo_id: number) =>
    mint_key(db() as unknown as Db, { npo_id, minted_by: staff.id });
  return {
    mine,
    theirs,
    key: await mint(mine.id),
    other: await mint(theirs.id),
  };
};

const body = (patch: Record<string, unknown> = {}) => ({
  gift_id: "gift-1",
  amount: {
    gift: 5000,
    gift_fee_cover: 150,
    contribution: 750,
    contribution_fee_cover: 30,
  },
  currency: "USD",
  method: "card",
  contribution_offered: true,
  deployment_origin: "https://giving.example.org",
  donor: { email: "Donor@Example.org", first_name: "Dee" },
  form: { id: "form-1", name: "Give" },
  ...patch,
});

const post = (token: string | null, payload: unknown) =>
  action({
    request: new Request("https://app.test/api/partner/v1/payments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }),
    params: {},
    context: {},
  } as never);

const get = (token: string, id: string) =>
  read({
    request: new Request(`https://app.test/api/partner/v1/payments/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    params: { id },
    context: {},
  } as never);

const donation_rows = () => db().select().from(donations);

describe("POST /api/partner/v1/payments", () => {
  test.each(["card", "apple_pay", "google_pay", "ach"])(
    "%s answers a stripe client secret",
    async (method) => {
      const { key } = await seed();

      const res = await post(key.key, body({ method }));

      expect(res.status).toBe(200);
      const answer = await res.json();
      expect(answer).toEqual({
        id: expect.any(String),
        client: { provider: "stripe", token: "pi_1_secret_x" },
      });
      // the sum as sent: 5000 + 150 + 750 + 30 cents
      expect(pi_create.mock.calls[0]![0].amount).toBe(5930);
      const [row] = await donation_rows();
      expect(row!.id).toBe(answer.id);
    }
  );

  test.each(["paypal", "venmo"])(
    "%s answers the paypal order id",
    async (m) => {
      const { key } = await seed();

      const res = await post(key.key, body({ method: m }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        client: { provider: "paypal", token: "ORDER-1" },
      });
      expect(create_order).toHaveBeenCalledTimes(1);
      expect(await donation_rows()).toHaveLength(1);
      // the donation row is `paypal` for both, as at checkout: the capture
      // names venmo. the site's own record keeps the method it asked for
      const [held] = await db()
        .select({ method: partner_payments.method })
        .from(partner_payments);
      expect(held!.method).toBe(m);
    }
  );

  test("daf answers the payment id as the token, from the authorized session", async () => {
    const { key } = await seed();

    const res = await post(
      key.key,
      body({
        method: "daf",
        amount: {
          gift: 5000,
          gift_fee_cover: 0,
          contribution: 0,
          contribution_fee_cover: 0,
        },
        authorized_session_id: "wf_session_1",
      })
    );

    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(answer.client).toEqual({ provider: "chariot", token: answer.id });
    expect(create_grant).toHaveBeenCalledWith({
      workflowSessionId: "wf_session_1",
      amount: 5000,
    });
    // the grant is how its webhook finds this payment's donation
    expect(await partner_donation_of_grant(db() as never, "grant_1")).toBe(
      answer.id
    );
    expect(
      await partner_donation_of_grant(db() as never, "grant_x")
    ).toBeNull();
  });

  const daf = (gift_id: string, session: string) =>
    body({
      gift_id,
      method: "daf",
      amount: {
        gift: 5000,
        gift_fee_cover: 0,
        contribution: 0,
        contribution_fee_cover: 0,
      },
      authorized_session_id: session,
    });

  test("the payment id is the server's, whatever the grant's metadata names", async () => {
    const { key } = await seed();
    create_grant.mockResolvedValue({
      id: "grant_1",
      amount: 5000,
      metadata: { don_id: "chosen-by-the-browser" },
    });

    const { id } = await (await post(key.key, daf("g-1", "wf_1"))).json();

    expect(id).not.toBe("chosen-by-the-browser");
    expect(await partner_donation_of_grant(db() as never, "grant_1")).toBe(id);
  });

  test("a new gift on an authorization whose payment isn't recorded yet is told to wait, not that it is used", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new Error("chariot is down"));
    expect((await post(key.key, daf("g-1", "wf_1"))).status).toBe(500);

    const res = await post(key.key, daf("g-2", "wf_1"));

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  test("a second gift on an authorization that already paid is refused before any grant is made", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, daf("g-1", "wf_1"))).json();
    create_grant.mockClear();

    const res = await post(key.key, daf("g-2", "wf_1"));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(create_grant).not.toHaveBeenCalled();
    expect(await donation_rows()).toHaveLength(1);
    expect(await partner_donation_of_grant(db() as never, "grant_1")).toBe(
      first.id
    );
    // the refused gift id stays free
    create_grant.mockResolvedValue({ id: "grant_2", amount: 5000 });
    expect((await post(key.key, daf("g-2", "wf_2"))).status).toBe(200);
  });

  test("the webhook's way back also finds a payment by its authorization when the grant was never linked", async () => {
    const { key } = await seed();
    await post(key.key, daf("g-1", "wf_1"));
    await db().update(partner_payments).set({ grant_id: null });
    const [row] = await db().select().from(partner_payments);

    expect(
      await partner_donation_of_grant(db() as never, "grant_1", "wf_1")
    ).toBe(row!.donation_id);
    expect(
      await partner_donation_of_grant(db() as never, "grant_1", "wf_other")
    ).toBeNull();
  });

  test("a repeat is answered from the record after the nonprofit turned the rail off", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, body())).json();
    await db()
      .update(npos)
      .set({ donate_methods: ["daf"] })
      .where(eq(npos.registration_number, "EIN-MINE"));

    const again = await post(key.key, body());

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
  });

  test("a grant chariot is still processing is a retryable 503 provider_error, and the claim holds until it goes stale", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new ChariotError(409, "{}", null));

    const res = await post(key.key, daf("g-1", "wf_1"));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("provider_error");
    // the outcome is unknown, so the claim holds until it goes stale; the
    // retry then takes it over under the same payment id
    const [held] = await db().select().from(partner_payments);
    const waiting = await post(key.key, daf("g-1", "wf_1"));
    expect(waiting.status).toBe(503);
    expect(waiting.headers.get("retry-after")).toBe("30");
    await stale("g-1");
    const retry = await post(key.key, daf("g-1", "wf_1"));
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(held!.donation_id);
  });

  const stale = (gift_id = "gift-1") =>
    db()
      .update(partner_payments)
      .set({ claimed_at: new Date(Date.now() - 3 * 60_000).toISOString() })
      .where(eq(partner_payments.gift_id, gift_id));

  test("a request that lost its claim to a takeover can't release or overwrite the winner's row", async () => {
    const { key } = await seed();
    let fail!: (e: Error) => void;
    pi_create.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = reject))
    );
    const first = post(key.key, body());
    await vi.waitFor(async () => {
      expect(await db().select().from(partner_payments)).toHaveLength(1);
      expect(pi_create).toHaveBeenCalledTimes(1);
    });
    await stale();

    const second = await post(key.key, body());
    expect(second.status).toBe(200);
    const winner = await second.json();
    fail(new Error("processor down"));
    expect((await first).status).toBe(500);

    const [row] = await db().select().from(partner_payments);
    expect(row!.donation_id).toBe(winner.id);
    expect(row!.response).toEqual(winner);
    // the loser's failure must not close the donation the winner is using
    const [don] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, winner.id));
    expect(don!.status).toBe("created");
  });

  test("a daf retry after a request died takes over its claim and keeps its payment id", async () => {
    const { key, mine } = await seed();
    const payload = daf("g-1", "wf_1");
    const minted = crypto.randomUUID();
    await db()
      .insert(partner_payments)
      .values({
        npo_id: mine.id,
        gift_id: "g-1",
        fingerprint: fingerprint_of(payload as never),
        method: "daf",
        currency: "USD",
        amount: payload.amount,
        attribution: {} as never,
        claim_id: "dead",
        donation_id: minted,
      });
    await stale("g-1");

    const res = await post(key.key, payload);

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(minted);
  });

  test("a paypal order voided after an hour is replaced under the same gift_id", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });
    create_order.mockResolvedValue({ id: "ORDER-2" });

    const again = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();

    expect(again.client.token).toBe("ORDER-2");
    expect(again.id).not.toBe(first.id);
    const old = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, first.id));
    expect(old[0]!.status).toBe("expired");
  });

  test("a refused repeat leaves a voided paypal order's payment as it was", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });
    await db()
      .update(npos)
      .set({ donate_methods: ["daf"] })
      .where(eq(npos.registration_number, "EIN-MINE"));

    const res = await post(key.key, body({ method: "paypal" }));

    expect(res.status).toBe(422);
    const [row] = await db().select().from(partner_payments);
    expect(row!.donation_id).toBe(first.id);
    const [don] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, first.id));
    expect(don!.status).toBe("created");
  });

  test("a paypal order still open after an hour is replayed", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "CREATED" });

    expect(
      await (await post(key.key, body({ method: "paypal" }))).json()
    ).toEqual(first);
    expect(create_order).toHaveBeenCalledTimes(1);
  });

  test("a paypal order paypal no longer has is replaced under the same gift_id", async () => {
    const { key } = await seed();
    await post(key.key, body({ method: "paypal" }));
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockRejectedValue(new PayPalApiError("get order", 404, "{}"));
    create_order.mockResolvedValue({ id: "ORDER-2" });

    const again = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();

    expect(again.client.token).toBe("ORDER-2");
  });

  test("a paypal order whose donation is no longer open is replayed without asking paypal", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, first.id));
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });

    expect(
      await (await post(key.key, body({ method: "paypal" }))).json()
    ).toEqual(first);
    expect(get_order).not.toHaveBeenCalled();
  });

  test("a young paypal order is replayed without asking paypal", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    get_order.mockResolvedValue({ status: "VOIDED" });

    expect(
      await (await post(key.key, body({ method: "paypal" }))).json()
    ).toEqual(first);
    expect(get_order).not.toHaveBeenCalled();
  });

  test("an old stripe payment is replayed without asking paypal, even if paypal would say voided", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, body())).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });

    expect(await (await post(key.key, body())).json()).toEqual(first);
    expect(get_order).not.toHaveBeenCalled();
  });

  test("a stripe intent is made under a key from the payment id, so a retry finds the same intent", async () => {
    const { key } = await seed();

    const { id } = await (await post(key.key, body())).json();

    expect(pi_create.mock.calls[0]![1]).toEqual({
      idempotencyKey: `partner-pi-${id}`,
    });
  });

  test("a request that is still young holds its gift_id: the same request is told to retry", async () => {
    const { key, mine } = await seed();
    const payload = body();
    await db()
      .insert(partner_payments)
      .values({
        npo_id: mine.id,
        gift_id: "gift-1",
        fingerprint: fingerprint_of(payload as never),
        method: "card",
        currency: "USD",
        amount: payload.amount,
        attribution: {} as never,
        claim_id: "live",
        donation_id: crypto.randomUUID(),
      });

    const res = await post(key.key, payload);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).code).toBe("provider_error");
    expect(pi_create).not.toHaveBeenCalled();
  });

  test("a retry on another authorization is a conflict, not a second grant", async () => {
    const { key } = await seed();
    await post(key.key, daf("g-1", "wf_1"));
    create_grant.mockClear();

    const res = await post(key.key, daf("g-1", "wf_2"));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("idempotency_conflict");
    expect(create_grant).not.toHaveBeenCalled();
  });

  test("an authorization made for another amount is refused and records nothing", async () => {
    const { key } = await seed();
    create_grant.mockResolvedValue({ id: "grant_9", amount: 1200 });

    const res = await post(key.key, daf("g-1", "wf_1"));

    expect(res.status).toBe(400);
    expect(await donation_rows()).toHaveLength(0);
  });

  test("a paypal gift paid meanwhile is replayed, not reissued, whatever paypal now says", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, first.id));
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockRejectedValue(new PayPalApiError("get order", 404, "{}"));

    expect(
      await (await post(key.key, body({ method: "paypal" }))).json()
    ).toEqual(first);
    expect(create_order).toHaveBeenCalledTimes(1);
  });

  test("a retry after a stripe request died takes over the claim and reuses its donation and keys", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, body())).json();
    // the process died before the answer was recorded
    await db().update(partner_payments).set({ response: null });
    await stale();

    const retry = await (await post(key.key, body())).json();

    expect(retry.id).toBe(first.id);
    expect(await donation_rows()).toHaveLength(1);
    expect(pi_create).toHaveBeenCalledTimes(2);
    expect(pi_create.mock.calls[1]![1]).toEqual({
      idempotencyKey: `partner-pi-${first.id}`,
    });
    expect(pi_create.mock.calls[1]![0].metadata).toEqual({
      order_id: first.id,
    });
  });

  test("a stripe refusal closes its unpaid donation and frees the gift_id", async () => {
    const { key } = await seed();
    pi_create.mockRejectedValueOnce(
      Object.assign(
        new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          message: "x",
          code: "amount_too_large",
        } as never),
        {}
      )
    );

    const res = await post(key.key, body());

    expect(res.status).toBe(422);
    expect((await donation_rows())[0]!.status).toBe("failed");
    expect(await db().select().from(partner_payments)).toHaveLength(0);
    expect((await post(key.key, body())).status).toBe(200);
  });

  test("a stripe retry's customer is keyed by the payment id too", async () => {
    const { key } = await seed();

    const { id } = await (await post(key.key, body())).json();

    expect(customer_with_currency).toHaveBeenCalledWith(
      "USD",
      "donor@example.org",
      `partner-cus-${id}`
    );
  });

  test("a daf repeat is answered from the record", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, daf("g-1", "wf_1"))).json();
    create_grant.mockClear();

    expect(await (await post(key.key, daf("g-1", "wf_1"))).json()).toEqual(
      first
    );
    expect(create_grant).not.toHaveBeenCalled();
  });

  test("a daf payment without an authorized session is invalid_request", async () => {
    const { key } = await seed();

    const res = await post(key.key, body({ method: "daf" }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(create_grant).not.toHaveBeenCalled();
  });

  test("a daf authorization that ran out is 410 authorization_expired", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValue(new ChariotError(410, "{}", null));

    const res = await post(
      key.key,
      body({
        method: "daf",
        amount: {
          gift: 5000,
          gift_fee_cover: 0,
          contribution: 0,
          contribution_fee_cover: 0,
        },
        authorized_session_id: "wf_old",
      })
    );

    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("authorization_expired");
  });

  test("the same gift_id again answers the same payment and makes no second session", async () => {
    const { key } = await seed();

    const first = await (await post(key.key, body())).json();
    const again = await post(key.key, body());

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(pi_create).toHaveBeenCalledTimes(1);
    expect(await donation_rows()).toHaveLength(1);
  });

  test("two requests at once for one gift_id make one session", async () => {
    const { key } = await seed();

    const [a, b] = await Promise.all([
      post(key.key, body()),
      post(key.key, body()),
    ]);

    expect(pi_create).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual([
      200,
      a.status === 200 && b.status === 200 ? 200 : 503,
    ]);
  });

  test.each([
    [
      "amount",
      {
        amount: {
          gift: 6000,
          gift_fee_cover: 0,
          contribution: 0,
          contribution_fee_cover: 0,
        },
      },
    ],
    ["method", { method: "paypal" }],
  ])(
    "the same gift_id with another %s is 409 idempotency_conflict",
    async (_, patch) => {
      const { key } = await seed();
      await post(key.key, body());

      const res = await post(key.key, body(patch));

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("idempotency_conflict");
      expect(pi_create).toHaveBeenCalledTimes(1);
    }
  );

  test("a gift_id is unique per tenant, not across them", async () => {
    const { key, other } = await seed();

    expect((await post(key.key, body())).status).toBe(200);
    expect((await post(other.key, body())).status).toBe(200);

    expect(pi_create).toHaveBeenCalledTimes(2);
  });

  test("the payment is for the key's own nonprofit, whatever the body names", async () => {
    const { key, mine, theirs } = await seed();

    const res = await post(
      key.key,
      body({ to_id: theirs.id, npo_id: theirs.id })
    );

    expect(res.status).toBe(200);
    const [row] = await db()
      .select({ npo_id: donation_recipients.npo_id })
      .from(donation_recipients);
    expect(row!.npo_id).toBe(mine.id);
    const rows = await db()
      .select({ npo_id: partner_payments.npo_id })
      .from(partner_payments);
    expect(rows).toEqual([{ npo_id: mine.id }]);
  });

  test("a gift below the minimum is 422 below_minimum with minimum_minor, and the gift_id stays free", async () => {
    const { key } = await seed();

    const res = await post(
      key.key,
      body({
        amount: {
          gift: 100,
          gift_fee_cover: 0,
          contribution: 0,
          contribution_fee_cover: 0,
        },
      })
    );

    expect(res.status).toBe(422);
    const problem = await res.json();
    expect(problem.code).toBe("below_minimum");
    expect(problem.minimum_minor).toBe(200);
    expect(pi_create).not.toHaveBeenCalled();

    expect((await post(key.key, body())).status).toBe(200);
  });

  test("a rail the nonprofit did not enable is 422 unsupported", async () => {
    const { key } = await seed();
    await db()
      .update(npos)
      .set({ donate_methods: ["stripe"] })
      .where(eq(npos.registration_number, "EIN-MINE"));

    const res = await post(key.key, body({ method: "ach" }));

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsupported");
  });

  test("a currency the nonprofit does not take is 422 unsupported", async () => {
    const { key } = await seed();

    const res = await post(key.key, body({ currency: "EUR" }));

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsupported");
  });

  test("crypto is not available in this release", async () => {
    const { key } = await seed();

    const res = await post(key.key, body({ method: "crypto", coin: "BTC" }));

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsupported");
  });

  test("a contribution the form never offered is invalid_request", async () => {
    const { key } = await seed();

    const res = await post(key.key, body({ contribution_offered: false }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  test("a negative part is invalid_request naming the field", async () => {
    const { key } = await seed();

    const res = await post(
      key.key,
      body({
        amount: {
          gift: 5000,
          gift_fee_cover: -1,
          contribution: 0,
          contribution_fee_cover: 0,
        },
      })
    );

    expect(res.status).toBe(400);
    const problem = await res.json();
    expect(problem.errors[0].path).toBe("amount.gift_fee_cover");
  });

  test("a missing or unknown key is 401 key_invalid", async () => {
    await seed();

    expect((await post(null, body())).status).toBe(401);
    expect((await post("spk_nope", body())).status).toBe(401);
  });

  test("a repeat of a made payment spends none of the donor address's limit, and another nonprofit has its own", async () => {
    const { key, other } = await seed();
    // mid-minute, so the limiter's 60s window can't roll over mid-test
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:20.000Z"));
    onTestFinished(() => void vi.useRealTimers());
    await post(key.key, body({ donor_ip: "203.0.113.5" }));
    for (let i = 0; i < DONOR_IP_QUOTA.max * 2; i++) {
      expect(
        (await post(key.key, body({ donor_ip: "203.0.113.5" }))).status
      ).toBe(200);
    }
    for (let i = 1; i < DONOR_IP_QUOTA.max; i++) {
      await post(key.key, body({ gift_id: `n-${i}`, donor_ip: "203.0.113.5" }));
    }
    expect(
      (
        await post(
          key.key,
          body({ gift_id: "n-over", donor_ip: "203.0.113.5" })
        )
      ).status
    ).toBe(429);
    expect(
      (await post(other.key, body({ gift_id: "o-1", donor_ip: "203.0.113.5" })))
        .status
    ).toBe(200);
  });

  test("one donor address is limited, answered 429 with retry-after", async () => {
    const { key } = await seed();
    // mid-minute, so the limiter's 60s window can't roll over mid-test
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:20.000Z"));
    onTestFinished(() => void vi.useRealTimers());

    for (let i = 0; i < DONOR_IP_QUOTA.max; i++) {
      const res = await post(
        key.key,
        body({ gift_id: `g-${i}`, donor_ip: "203.0.113.9" })
      );
      expect(res.status).toBe(200);
    }
    const limited = await post(
      key.key,
      body({ gift_id: "g-over", donor_ip: "203.0.113.9" })
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    const elsewhere = await post(
      key.key,
      body({ gift_id: "g-else", donor_ip: "203.0.113.10" })
    );
    expect(elsewhere.status).toBe(200);
  });
});

describe("GET /api/partner/v1/payments/{id}", () => {
  test("answers the payment as held, and never calls a processor", async () => {
    const { key } = await seed();
    const { id } = await (await post(key.key, body())).json();
    pi_create.mockClear();

    const res = await get(key.key, id);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      id,
      gift_id: "gift-1",
      status: "pending",
      method: "card",
      amount: {
        gift: 5000,
        gift_fee_cover: 150,
        contribution: 750,
        contribution_fee_cover: 30,
      },
      currency: "USD",
      fee: null,
      occurred_at: expect.any(String),
    });
    expect(pi_create).not.toHaveBeenCalled();
  });

  test("a settled donation reads succeeded", async () => {
    const { key } = await seed();
    const { id } = await (await post(key.key, body())).json();
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, id));

    expect((await (await get(key.key, id)).json()).status).toBe("succeeded");
  });

  test("another nonprofit's key reads 404 for it", async () => {
    const { key, other } = await seed();
    const { id } = await (await post(key.key, body())).json();

    const res = await get(other.key, id);

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });
});
