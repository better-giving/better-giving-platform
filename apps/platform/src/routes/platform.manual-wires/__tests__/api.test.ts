import { and, eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
vi.mock("$/env", () => ({ stage: "test", owed_deductions: false }));
vi.mock("$/kit/slack", () => ({
  aws_monitor: { send_alert: vi.fn() },
  fiat_monitor: { send_alert: vi.fn() },
}));
vi.mock("$/kit/wise", () => ({ wise: {} }));
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
/** who the request's session cookie signs in, or no one */
const session = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
}));
// the real guard and context; only the better-auth instance is a stand-in
vi.mock("#/.server/auth/auth", () => ({
  auth: {
    api: { getSession: async () => session.user && { user: session.user } },
  },
}));
vi.mock("#/.server/auth", async () => {
  const m = await import("#/.server/auth/middleware");
  return {
    user_ctx: m.user_ctx,
    auth_mdlwr: m.auth_mdlwr,
    admin_mdlwr: m.admin_mdlwr,
  };
});
// a second provider reaches `mark_wired` only through its `providers`
// argument, as in its own tests: `WIRE_PROVIDERS` names one
vi.mock("$/payouts/manual-wire", async (io) => {
  const actual = await io<typeof import("$/payouts/manual-wire")>();
  return {
    ...actual,
    mark_wired: (i: Parameters<typeof actual.mark_wired>[0]) =>
      actual.mark_wired(i, ["Mercury", "Other Bank"]),
  };
});

const { action, loader } = await import("../api");
const { middleware } = await import("../../platform/route");
const { user } = await import("$/pg/schema/auth");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { npos } = await import("$/pg/schema/npo");
const { payouts, settlements, manual_wires } = await import(
  "$/pg/schema/payout"
);

const db = () => test_db.current!.db;

const ADMIN = "admin-wires";

beforeAll(async () => {
  test_db.current = await create_test_db();
  await db().insert(user).values({
    id: ADMIN,
    name: "Admin Wires",
    email: "admin-wires@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Admin",
    last_name: "Wires",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(payouts);
  await db().delete(manual_wires);
  await db().delete(settlements);
  await db().delete(npos);
});

let seq = 0;
async function seed_npo(
  o: {
    payout_method?: "wise" | "manual_wire";
    payout_minimum?: number;
    name?: string;
  } = {}
) {
  seq += 1;
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-WIRE-ROUTE-${seq}`,
      name: o.name ?? `Wire NPO ${seq}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: 1000,
      payout_minimum: o.payout_minimum,
      payout_method: o.payout_method ?? "manual_wire",
    })
    .returning();
  return npo!.id;
}

async function seed_payout(
  npo_id: number,
  id: string,
  amount: number,
  type: "pending" | "settled" = "pending"
) {
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-09-01T00:00:00.000Z",
      amount,
      type,
    });
}

/** the ids of the npo's payouts pending now, as the dialog sends them */
const pending_ids = async (npo_id: number) =>
  (
    await db()
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.npo_id, npo_id), eq(payouts.type, "pending")))
      .orderBy(payouts.id)
  ).map((p) => p.id);

/** a wire for what the npo has pending now, unless `o` says otherwise */
const wire = async (npo_id: number, o: Record<string, unknown> = {}) => ({
  npo_id,
  wire_date: "2026-11-18",
  amount_sent: 100,
  provider: "Mercury",
  provider_tx_id: "tx-1",
  wire_fee: 0,
  payout_ids: await pending_ids(npo_id),
  ...o,
});

const AS_ADMIN = { id: ADMIN, role: "admin" };

/** posts through the platform layout's own middleware, as a request does */
async function post(body: unknown, as: typeof session.user = AS_ADMIN) {
  session.user = as;
  const args = {
    ...doc_args(
      new Request("https://app.test/platform/manual-wires", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
    ),
    context: new RouterContextProvider(),
    params: {},
  };
  const run = (i: number): Promise<unknown> => {
    const mw = middleware[i];
    return mw ? (mw as any)(args, () => run(i + 1)) : action(args as any);
  };
  const res = await run(0).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  if (!(res instanceof Response)) return { status: 200, body: res };
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** everything a mark writes */
const ledger = async () => ({
  wires: await db().select().from(manual_wires),
  settlements: await db().select().from(settlements),
  payouts: await db()
    .select({ id: payouts.id, type: payouts.type })
    .from(payouts)
    .orderBy(payouts.id),
  cash: await db().select({ id: npos.id, cash: npos.cash }).from(npos),
});

describe("mark wired", () => {
  test("a transaction already recorded at that provider is refused with 409, and nothing is written", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    expect(await post(await wire(npo, { provider_tx_id: "MT-77" }))).toEqual({
      status: 200,
      body: { ok: true },
    });
    await seed_payout(npo, "p-2", 80);
    const before = await ledger();

    const res = await post(
      await wire(npo, { provider_tx_id: "MT-77", amount_sent: 80 })
    );

    expect(res).toEqual({
      status: 409,
      body: {
        status: 409,
        message:
          "Transaction MT-77 from Mercury is already recorded. Check the id with the provider.",
      },
    });
    expect(await ledger()).toEqual(before);
  });

  test("the recorded wire carries the signed-in admin who marked it", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);

    expect(await post(await wire(npo))).toEqual({
      status: 200,
      body: { ok: true },
    });

    const { wires } = await ledger();
    expect(wires).toEqual([expect.objectContaining({ recorded_by: ADMIN })]);
  });

  test("the same transaction id at another provider is a different wire, and settles", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    await post(await wire(npo, { provider_tx_id: "MT-77" }));
    await seed_payout(npo, "p-2", 80);

    const res = await post(
      await wire(npo, {
        provider_tx_id: "MT-77",
        provider: "Other Bank",
        amount_sent: 80,
      })
    );

    expect(res).toEqual({ status: 200, body: { ok: true } });
    const { payouts: after, wires } = await ledger();
    expect(after).toEqual([
      { id: "p-1", type: "settled" },
      { id: "p-2", type: "settled" },
    ]);
    expect(wires).toHaveLength(2);
  });

  const refused = (status: number, message: string) => ({
    status,
    body: { status, message },
  });

  test("a wire that is not the net less its fee is refused without the figure, and nothing is written", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 1234.5);
    const before = await ledger();

    const res = await post(
      await wire(npo, { amount_sent: 1234.5, wire_fee: 25 })
    );

    expect(res).toEqual(
      refused(
        400,
        "The amount sent doesn't match the net total less the wire fee, so nothing was recorded."
      )
    );
    expect(await ledger()).toEqual(before);
  });

  test("payouts that changed while the dialog was open are refused, and nothing is written", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    const opened = await wire(npo);
    await seed_payout(npo, "p-2", 80);
    const before = await ledger();

    expect(await post(opened)).toEqual(
      refused(
        409,
        "The payouts changed while this was open, so nothing was recorded. Check the updated amounts and mark it wired again."
      )
    );
    expect(await ledger()).toEqual(before);
  });

  test("anyone but a signed-in platform admin is refused by the platform guard, and nothing is written", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    const before = await ledger();

    expect(await post(await wire(npo), { id: ADMIN, role: "user" })).toEqual({
      status: 403,
      body: null,
    });
    const anonymous = await post(await wire(npo), null);
    expect(anonymous.status).toBe(302);
    expect(await ledger()).toEqual(before);
  });

  test("a net under the nonprofit's minimum is refused with that minimum", async () => {
    const npo = await seed_npo({ payout_minimum: 150 });
    await seed_payout(npo, "p-1", 100);

    expect(await post(await wire(npo))).toEqual(
      refused(409, "Under the $150.00 payout minimum")
    );
  });

  test("a nonprofit paid by wise is refused", async () => {
    const npo = await seed_npo({ payout_method: "wise" });
    await seed_payout(npo, "p-1", 100);

    expect(await post(await wire(npo))).toEqual(
      refused(409, "This nonprofit is not paid by manual wire")
    );
  });

  test("a nonprofit whose payouts were all settled since the page loaded is refused", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100, "settled");

    expect(await post(await wire(npo, { payout_ids: ["p-1"] }))).toEqual(
      refused(409, "Nothing is pending for this nonprofit")
    );
  });

  test("a value mark_wired refuses names its field", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);

    expect(await post(await wire(npo, { provider: "Nobody" }))).toEqual(
      refused(400, "Check the provider")
    );
    expect(await post(await wire(npo, { wire_date: "2026-02-31" }))).toEqual(
      refused(400, "Check the wire date")
    );
    expect(await post(await wire(npo, { provider_tx_id: "  " }))).toEqual(
      refused(400, "Check the transaction id")
    );
  });

  test("a malformed body is refused with 400, and nothing is written", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    const before = await ledger();

    expect(await post("not json")).toEqual(
      refused(400, "Check the form and try again")
    );
    expect(await post(await wire(npo, { amount_sent: "100" }))).toEqual(
      refused(400, "Check the amount sent")
    );
    expect(await post(await wire(npo, { npo_id: 1.5 }))).toEqual(
      refused(400, "Check the nonprofit")
    );
    expect(await ledger()).toEqual(before);
  });
});

describe("the list", () => {
  test("holds only nonprofits paid by manual wire with payouts pending", async () => {
    const due = await seed_npo({ name: "River Trust" });
    await seed_payout(due, "p-1", 100);
    const by_wise = await seed_npo({ payout_method: "wise" });
    await seed_payout(by_wise, "w-1", 100);
    const settled = await seed_npo({ name: "Paid Up Trust" });
    await seed_payout(settled, "s-1", 100, "settled");

    const { rows } = await loader();

    expect(rows.map((r) => [r.npo_id, r.name, r.net])).toEqual([
      [due, "River Trust", 100],
    ]);
  });

  test("holds a nonprofit under its minimum with that minimum, and no wise or inactive nonprofit", async () => {
    const due = await seed_npo({ name: "River Trust", payout_minimum: 100 });
    await seed_payout(due, "p-1", 100);
    const short = await seed_npo({ name: "Short Trust", payout_minimum: 250 });
    await seed_payout(short, "p-2", 100);
    const by_wise = await seed_npo({
      name: "Wise Trust",
      payout_method: "wise",
    });
    await seed_payout(by_wise, "w-1", 100);
    const closed = await seed_npo({ name: "Closed Trust" });
    await db().update(npos).set({ active: false }).where(eq(npos.id, closed));
    await seed_payout(closed, "c-1", 100);

    const { rows } = await loader();

    expect(rows.map((r) => [r.name, r.net, r.minimum])).toEqual([
      ["River Trust", 100, 100],
      ["Short Trust", 100, 250],
    ]);
  });
});
