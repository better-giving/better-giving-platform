import { ChariotError } from "@better-giving/chariot";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const pi_create = vi.hoisted(() => vi.fn());
const create_order = vi.hoisted(() => vi.fn());
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
vi.mock("$/kit/paypal", () => ({ paypal: { create_order } }));
vi.mock("$/kit/chariot", () => ({ chariot: { create_grant } }));
vi.mock("#/.server/unit-per-usd", () => ({ unit_per_usd: async () => 1 }));
vi.mock("#/routes/api.donation-intents/stripe/customer-with-currency", () => ({
  customer_with_currency: async () => "cus_1",
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
const { DONOR_IP_QUOTA } = await import("$/partner/payments");
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
  pi_create.mockResolvedValue({ client_secret: "pi_1_secret_x" });
  create_order.mockResolvedValue({ id: "ORDER-1" });
  create_grant.mockImplementation(async () => ({
    id: "grant_1",
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
      metadata: { don_id: "chosen-by-the-browser" },
    });

    const { id } = await (await post(key.key, daf("g-1", "wf_1"))).json();

    expect(id).not.toBe("chosen-by-the-browser");
    expect(await partner_donation_of_grant(db() as never, "grant_1")).toBe(id);
  });

  test("a second gift on an authorization that already paid is refused and leaves nothing payable", async () => {
    const { key } = await seed();
    const first = await (await post(key.key, daf("g-1", "wf_1"))).json();

    const res = await post(key.key, daf("g-2", "wf_1"));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(await partner_donation_of_grant(db() as never, "grant_1")).toBe(
      first.id
    );
    const rows = await donation_rows();
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(1);
    // the refused gift id stays free
    create_grant.mockResolvedValue({ id: "grant_2" });
    expect((await post(key.key, daf("g-2", "wf_2"))).status).toBe(200);
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
      a.status === 200 && b.status === 200 ? 200 : 409,
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

  test("one donor address is limited, answered 429 with retry-after", async () => {
    const { key } = await seed();

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
