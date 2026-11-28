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
const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({
  report_error,
  report_degraded: vi.fn(),
}));
vi.mock("$/kit/stripe", () => ({
  stripe: { paymentIntents: { create: pi_create } },
}));
vi.mock("$/kit/paypal", () => ({ paypal: { create_order, get_order } }));
vi.mock("$/kit/chariot", () => ({ chariot: { create_grant } }));
const send_email = vi.hoisted(() =>
  vi.fn(async (_mail: { to: string[] }) => ({ id: "mail-1" }))
);
vi.mock("$/email", () => ({ send_email_or_throw: send_email }));
vi.mock(
  "#/routes/api.q-handler.$event/handle-don-receipt/send-receipt",
  () => ({ send_receipt: async () => {} })
);
vi.mock("#/.server/unit-per-usd", () => ({ unit_per_usd: async () => 1 }));
vi.mock("#/routes/api.donation-intents/stripe/customer-with-currency", () => ({
  customer_with_currency,
}));
vi.mock("#/routes/api.donation-intents/stripe/descriptor-suffix", () => ({
  npo_descriptor_suffix: async () => undefined,
}));

const { create_test_db } = await import("$/pg/test-utils/pglite");
const { donation_recipients, donation_tributes, donations } = await import(
  "$/pg/schema/donation"
);
const { user } = await import("$/pg/schema/auth");
const { npos } = await import("$/pg/schema/npo");
const { partner_keys, partner_payments, partner_tenants } = await import(
  "$/pg/schema/partner"
);
const { rate_limit_windows } = await import("$/pg/schema/rate-limit");
const { mint_key } = await import("$/partner/keys");
const { DONOR_IP_QUOTA, fingerprint_of } = await import("$/partner/payments");
const { partner_donation_of_grant } = await import("$/partner/grant-donation");
const { donation_get } = await import("$/pg/queries/donation");
const { handle_don_receipt } = await import(
  "#/routes/api.q-handler.$event/handle-don-receipt"
);
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
    expect(res.headers.get("retry-after")).toBe("120");
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
    expect(waiting.headers.get("retry-after")).toBe("120");
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
    expect(res.headers.get("retry-after")).toBe("120");
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
    // the row written ahead of the grant is closed, and the gift id is free
    expect((await donation_rows()).map((r) => r.status)).toEqual(["failed"]);
    expect(await db().select().from(partner_payments)).toHaveLength(0);
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

  test("a daf row is written before its grant, under the session, and links the grant after", async () => {
    const { key } = await seed();
    let seen: { status: string; via_extra: string | null }[] = [];
    create_grant.mockImplementationOnce(async () => {
      seen = await donation_rows();
      return { id: "grant_1", amount: 5000 };
    });

    const { id } = await (await post(key.key, daf("g-1", "wf_1"))).json();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: "intent", via_extra: "wf_1" });
    const [row] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, id));
    expect(row!.via_extra).toBe("grant_1");
  });

  test("a new gift takes over a stale unrecorded authorization and keeps its donation", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new Error("lost the reply"));
    expect((await post(key.key, daf("g-1", "wf_1"))).status).toBe(500);
    const [first] = await donation_rows();
    await stale("g-1");

    const res = await post(key.key, daf("g-2", "wf_1"));

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(first!.id);
    expect(await donation_rows()).toHaveLength(1);
    const rows = await db().select().from(partner_payments);
    expect(rows.map((r) => r.gift_id)).toEqual(["g-2"]);
  });

  test("a grant another donation already records is refused, and nothing is linked", async () => {
    const { key, other } = await seed();
    await post(key.key, daf("g-1", "wf_1"));
    await db()
      .update(npos)
      .set({ donate_methods: ["daf"] })
      .where(eq(npos.registration_number, "EIN-THEM"));
    create_grant.mockResolvedValue({ id: "grant_1", amount: 5000 });

    const res = await post(other.key, daf("g-9", "wf_2"));

    expect(res.status).toBe(400);
    expect(
      await partner_donation_of_grant(db() as never, "grant_1")
    ).not.toBeNull();
    expect(
      (await donation_rows()).filter((r) => r.status === "failed")
    ).toHaveLength(1);
  });

  test("a stripe retry sends the customer and suffix its first attempt chose", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, body())).json();
    const [held] = await db().select().from(partner_payments);
    expect(held!.provider_state).toEqual({
      customer_id: "cus_1",
      descriptor_suffix: null,
    });
    customer_with_currency.mockResolvedValue("cus_2");
    await db().update(partner_payments).set({ response: null });
    await stale();

    const retry = await (await post(key.key, body())).json();

    expect(retry.id).toBe(first.id);
    expect(customer_with_currency).toHaveBeenCalledTimes(1);
    expect(pi_create.mock.calls[1]![0].customer).toBe("cus_1");
  });

  test("a stripe 5xx releases the claim and closes its row, so the retry runs under new keys, not the cached failure's", async () => {
    const { key } = await seed();
    pi_create.mockRejectedValueOnce(
      new Stripe.errors.StripeAPIError({
        message: "slow",
        type: "api_error",
        statusCode: 500,
      } as never)
    );

    const res = await post(key.key, body());

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(await db().select().from(partner_payments)).toHaveLength(0);
    const [failed] = await donation_rows();
    expect(failed!.status).toBe("failed");

    const retry = await (await post(key.key, body())).json();

    expect(retry.id).not.toBe(failed!.id);
    expect(pi_create.mock.calls[1]![1]).toEqual({
      idempotencyKey: `partner-pi-${retry.id}`,
    });
  });

  test.each([
    [
      "connection error",
      () =>
        new Stripe.errors.StripeConnectionError({
          message: "reset",
          type: "api_connection_error",
        } as never),
    ],
    [
      "rate limit",
      () =>
        new Stripe.errors.StripeRateLimitError({
          message: "slow down",
          type: "rate_limit_error",
          statusCode: 429,
        } as never),
    ],
    [
      "409 key in use",
      () =>
        new Stripe.errors.StripeAPIError({
          message: "in use",
          type: "api_error",
          statusCode: 409,
        } as never),
    ],
  ])(
    "a stripe %s keeps the claim and the retry reuses its keys",
    async (_, err) => {
      const { key } = await seed();
      pi_create.mockRejectedValueOnce(err());

      const res = await post(key.key, body());

      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("120");
      const [held] = await db().select().from(partner_payments);
      await stale();

      const retry = await (await post(key.key, body())).json();

      expect(retry.id).toBe(held!.donation_id);
      expect(pi_create.mock.calls[1]![1]).toEqual(pi_create.mock.calls[0]![1]);
    }
  );

  test("a stripe idempotency error is ours: 502, reported, and the gift id is free", async () => {
    const { key } = await seed();
    pi_create.mockRejectedValueOnce(
      new Stripe.errors.StripeIdempotencyError({
        message: "other params",
        type: "idempotency_error",
      } as never)
    );

    const res = await post(key.key, body());

    expect(res.status).toBe(502);
    expect(report_error).toHaveBeenCalled();
    expect(await db().select().from(partner_payments)).toHaveLength(0);
  });

  test.each([
    ["a paypal 5xx", () => new PayPalApiError("create order", 500, "{}"), 503],
    [
      "a paypal refusal",
      () => new PayPalApiError("create order", 422, "{}"),
      502,
    ],
  ])(
    "%s is answered as a provider failure, not a plain 500",
    async (_, err, status) => {
      const { key } = await seed();
      create_order.mockRejectedValueOnce(err());

      const res = await post(key.key, body({ method: "paypal" }));

      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe("provider_error");
    }
  );

  test("a chariot 5xx is a retryable 503 and its claim holds", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new ChariotError(502, "{}", null));

    const res = await post(key.key, daf("g-1", "wf_1"));

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    expect(await db().select().from(partner_payments)).toHaveLength(1);
  });

  test("a replaced paypal order's payment id still reads, as cancelled, with its own gift id", async () => {
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

    const old = await (await get(key.key, first.id)).json();

    expect(old).toMatchObject({
      id: first.id,
      gift_id: "gift-1",
      status: "cancelled",
    });
    expect(again.id).not.toBe(first.id);
    expect((await (await get(key.key, again.id)).json()).gift_id).toBe(
      "gift-1"
    );
  });

  test("a paypal failure after a reissue keeps the old payment readable, and its retry finds the same order", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });
    create_order.mockRejectedValueOnce(
      new PayPalApiError("create order", 500, "{}")
    );

    expect((await post(key.key, body({ method: "paypal" }))).status).toBe(503);

    expect((await (await get(key.key, first.id)).json()).status).toBe(
      "cancelled"
    );
    await stale();
    create_order.mockResolvedValue({ id: "ORDER-3" });
    const retry = await post(key.key, body({ method: "paypal" }));
    expect(retry.status).toBe(200);
    expect(create_order.mock.calls.at(-1)![1]).toBe(
      `order-${(await retry.json()).id}`
    );
  });

  test("a paypal timeout keeps the claim, so the retry reuses the donation and its request id", async () => {
    const { key } = await seed();
    create_order.mockRejectedValueOnce(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );
    expect((await post(key.key, body({ method: "paypal" }))).status).toBe(503);
    const [held] = await db().select().from(partner_payments);
    await stale();

    const retry = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();

    expect(retry.id).toBe(held!.donation_id);
    expect(await donation_rows()).toHaveLength(1);
  });

  test("a replaced order the donor paid anyway reads as paid, not cancelled", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "VOIDED" });
    create_order.mockResolvedValue({ id: "ORDER-2" });
    await post(key.key, body({ method: "paypal" }));
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, first.id));

    expect((await (await get(key.key, first.id)).json()).status).toBe(
      "succeeded"
    );
  });

  test("a takeover by a new gift must be the same request, or it is a conflict", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new Error("lost the reply"));
    await post(key.key, daf("g-1", "wf_1"));
    await stale("g-1");
    const other_amount = daf("g-2", "wf_1");
    other_amount.amount.gift = 6000;

    const res = await post(key.key, other_amount);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("idempotency_conflict");
    expect((await db().select().from(partner_payments))[0]!.gift_id).toBe(
      "g-1"
    );
  });

  test("a chariot rate limit is a retryable 503, and a chariot refusal is a 502 that closes its row", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new ChariotError(429, "{}", null));
    expect((await post(key.key, daf("g-1", "wf_1"))).status).toBe(503);

    create_grant.mockRejectedValueOnce(new ChariotError(422, "{}", null));
    const res = await post(key.key, daf("g-2", "wf_2"));

    expect(res.status).toBe(502);
    expect(report_error).toHaveBeenCalled();
    expect(await db().select().from(partner_payments)).toHaveLength(1);
    expect(
      (await donation_rows()).filter((r) => r.status === "failed")
    ).toHaveLength(1);
  });

  test("a paypal order still CREATED is replayed whatever its age: only paypal's word that it is void replaces it", async () => {
    const { key } = await seed();
    const first = await (
      await post(key.key, body({ method: "paypal" }))
    ).json();
    await db()
      .update(partner_payments)
      .set({ created_at: new Date(Date.now() - 5 * 3600_000).toISOString() });
    get_order.mockResolvedValue({ status: "CREATED" });

    expect(
      await (await post(key.key, body({ method: "paypal" }))).json()
    ).toEqual(first);
    expect(create_order).toHaveBeenCalledTimes(1);
  });

  test("a partner gift with a tribute notification gets the tribute notice checkout gifts get", async () => {
    const { key } = await seed();
    const { id } = await (
      await post(
        key.key,
        body({
          tribute: {
            kind: "memory",
            honoree: "Rose Alvarez",
            notify: { name: "Mary Johnson", email: "mary@example.org" },
          },
        })
      )
    ).json();
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, id));

    expect((await donation_get(id))!.tribute).toEqual({
      full_name: "Rose Alvarez",
      notif: {
        to_email: "mary@example.org",
        to_fullname: "Mary Johnson",
        from_msg: "",
      },
    });
    await handle_don_receipt((await donation_get(id))!);

    expect(send_email.mock.calls.map((c) => c[0].to)).toContainEqual([
      "mary@example.org",
    ]);
  });

  test("a partner gift with no tribute sends no tribute notice", async () => {
    const { key } = await seed();
    const { id } = await (await post(key.key, body())).json();
    await db()
      .update(donations)
      .set({ status: "settled" })
      .where(eq(donations.id, id));

    await handle_don_receipt((await donation_get(id))!);

    expect(send_email).not.toHaveBeenCalled();
  });

  test.each([
    ["a dropped connection", () => new TypeError("fetch failed")],
    [
      "an unreadable reply",
      () => new SyntaxError("Unexpected end of JSON input"),
    ],
  ])(
    "%s on paypal keeps the claim, and the retry finds the same order identity",
    async (_, err) => {
      const { key } = await seed();
      create_order.mockRejectedValueOnce(err());

      const res = await post(key.key, body({ method: "paypal" }));

      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("120");
      const [held] = await db().select().from(partner_payments);
      expect(held).toBeDefined();
      expect((await donation_rows())[0]!.status).toBe("created");
      await stale();

      const retry = await (
        await post(key.key, body({ method: "paypal" }))
      ).json();

      expect(retry.id).toBe(held!.donation_id);
      expect(create_order.mock.calls[1]![1]).toBe(
        create_order.mock.calls[0]![1]
      );
      expect(create_order.mock.calls[0]![1]).toBe(`order-${held!.donation_id}`);
    }
  );

  test("a dropped connection on the daf rail is a retryable 503, not a bare 500, and keeps the claim", async () => {
    const { key } = await seed();
    create_grant.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await post(key.key, daf("g-1", "wf_1"));

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    const [held] = await db().select().from(partner_payments);
    await stale("g-1");
    const retry = await (await post(key.key, daf("g-1", "wf_1"))).json();
    expect(retry.id).toBe(held!.donation_id);
    // the retry asks for the same authorization, not a new one
    expect(create_grant.mock.calls.map((c) => c[0].workflowSessionId)).toEqual([
      "wf_1",
      "wf_1",
    ]);
  });

  test("a lost answer is reported, so a lasting cause does not loop unseen", async () => {
    const { key } = await seed();
    create_order.mockRejectedValueOnce(new TypeError("fetch failed"));

    await post(key.key, body({ method: "paypal" }));

    expect(report_error).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ provider: "lost answer" })
    );
  });

  test("an undici socket error with an errno cause is a lost answer too", async () => {
    const { key } = await seed();
    create_order.mockRejectedValueOnce(
      Object.assign(new TypeError("terminated"), {
        cause: Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET" }),
      })
    );

    const res = await post(key.key, body({ method: "paypal" }));

    expect(res.status).toBe(503);
    expect(await db().select().from(partner_payments)).toHaveLength(1);
  });

  test.each([
    ["a TypeError of our own", () => new TypeError("x is undefined")],
    ["a plain Error", () => new Error("boom")],
  ])(
    "%s is not a lost answer: a plain 500, and the gift id is free",
    async (_, err) => {
      const { key } = await seed();
      create_order.mockRejectedValueOnce(err());

      const res = await post(key.key, body({ method: "paypal" }));

      expect(res.status).toBe(500);
      expect(await db().select().from(partner_payments)).toHaveLength(0);
    }
  );

  test.each(["card", "apple_pay", "google_pay"])(
    "a partner %s intent is cards only, with no other method and none of the bank options",
    async (method) => {
      const { key } = await seed();

      await post(key.key, body({ method }));

      const params = pi_create.mock.calls[0]![0];
      expect(params.payment_method_types).toEqual(["card"]);
      expect(params).not.toHaveProperty("automatic_payment_methods");
      expect(params).not.toHaveProperty("payment_method_options");
    }
  );

  test("a partner ach intent stays bank only", async () => {
    const { key } = await seed();

    await post(key.key, body({ method: "ach" }));

    const params = pi_create.mock.calls[0]![0];
    expect(params.payment_method_types).toEqual([
      "us_bank_account",
      "acss_debit",
    ]);
    expect(params).not.toHaveProperty("automatic_payment_methods");
  });

  test("a daf tribute is saved before the grant exists, and on a recovered request too", async () => {
    const { key } = await seed();
    const tribute = {
      kind: "honor",
      honoree: "Rose Alvarez",
      notify: { name: "Mary Johnson", email: "mary@example.org" },
    };
    let at_grant: { name: string }[] = [];
    create_grant.mockImplementationOnce(async () => {
      at_grant = await db().select().from(donation_tributes);
      throw new TypeError("fetch failed");
    });
    // the first attempt carried the tribute and died with the grant maybe made
    expect(
      (await post(key.key, { ...daf("g-1", "wf_1"), tribute })).status
    ).toBe(503);
    expect(at_grant.map((t) => t.name)).toEqual(["Rose Alvarez"]);

    // a recovery whose first attempt wrote none gets it before its grant too
    await db().delete(donation_tributes);
    await stale("g-1");
    let at_retry: { name: string }[] = [];
    create_grant.mockImplementationOnce(async () => {
      at_retry = await db().select().from(donation_tributes);
      return { id: "grant_1", amount: 5000 };
    });
    expect(
      (await post(key.key, { ...daf("g-1", "wf_1"), tribute })).status
    ).toBe(200);
    expect(at_retry.map((t) => t.name)).toEqual(["Rose Alvarez"]);
    // the notify mapping is the checkout one, from the row the grant settles
    const [row] = await db().select().from(donation_tributes);
    expect(row).toMatchObject({
      name: "Rose Alvarez",
      notif_email: "mary@example.org",
      notif_fullname: "Mary Johnson",
      notif_msg: null,
    });
  });

  test("a mismatched retry of a gift id is a 409 before any current setting is read", async () => {
    const { key } = await seed();
    await post(key.key, body());
    await db()
      .update(npos)
      .set({ donate_methods: ["daf"] })
      .where(eq(npos.registration_number, "EIN-MINE"));

    for (const patch of [
      { currency: "EUR" },
      { method: "ach" },
      { method: "paypal" },
    ]) {
      const res = await post(key.key, body(patch));
      expect([res.status, (await res.json()).code]).toEqual([
        409,
        "idempotency_conflict",
      ]);
    }
    expect(pi_create).toHaveBeenCalledTimes(1);
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
