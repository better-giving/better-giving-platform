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
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { npos } = await import("$/pg/schema/npo");
const { payouts, settlements, manual_wires } = await import(
  "$/pg/schema/payout"
);

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
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

const wire = (npo_id: number, o: Record<string, unknown> = {}) => ({
  npo_id,
  wire_date: "2026-11-18",
  amount_sent: 100,
  provider: "Mercury",
  provider_tx_id: "tx-1",
  wire_fee: 0,
  ...o,
});

async function post(body: unknown) {
  const res = (await action({
    ...doc_args(
      new Request("https://app.test/platform/manual-wires", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
    ),
    context: {} as any,
    params: {},
  } as any)) as Response | object;
  return res instanceof Response
    ? { status: res.status, body: await res.json() }
    : { status: 200, body: res };
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
    expect(await post(wire(npo, { provider_tx_id: "MT-77" }))).toEqual({
      status: 200,
      body: { ok: true },
    });
    await seed_payout(npo, "p-2", 80);
    const before = await ledger();

    const res = await post(
      wire(npo, { provider_tx_id: "MT-77", amount_sent: 80 })
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

  test("the same transaction id at another provider is a different wire, and settles", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    await post(wire(npo, { provider_tx_id: "MT-77" }));
    await seed_payout(npo, "p-2", 80);

    const res = await post(
      wire(npo, {
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

  test("a wire that is not the net less its fee names the amount it must be", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 1234.5);

    const res = await post(wire(npo, { amount_sent: 1234.5, wire_fee: 25 }));

    expect(res).toEqual(
      refused(
        409,
        "The amount sent must be $1,209.50, the net total less the wire fee"
      )
    );
  });

  test("a net under the nonprofit's minimum is refused with that minimum", async () => {
    const npo = await seed_npo({ payout_minimum: 150 });
    await seed_payout(npo, "p-1", 100);

    expect(await post(wire(npo))).toEqual(
      refused(409, "Under the $150.00 payout minimum")
    );
  });

  test("a nonprofit paid by wise is refused", async () => {
    const npo = await seed_npo({ payout_method: "wise" });
    await seed_payout(npo, "p-1", 100);

    expect(await post(wire(npo))).toEqual(
      refused(409, "This nonprofit is not paid by manual wire")
    );
  });

  test("a nonprofit with nothing pending is refused", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100, "settled");

    expect(await post(wire(npo))).toEqual(
      refused(409, "Nothing is pending for this nonprofit")
    );
  });

  test("a nonprofit whose transfer came back and has no account to pay is held", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);
    await db().insert(settlements).values({
      id: "4242",
      other_id: "ref-4242",
      npo_id: npo,
      date: "2026-10-01T00:00:00.000Z",
      amount: 50,
      status: "returned",
    });

    expect(await post(wire(npo))).toEqual(
      refused(409, "A returned transfer holds this nonprofit's payouts")
    );
    const { payouts: after } = await ledger();
    expect(after).toEqual([{ id: "p-1", type: "pending" }]);
  });

  test("a value mark_wired refuses names its field", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);

    expect(await post(wire(npo, { provider: "Nobody" }))).toEqual(
      refused(400, "Check the provider")
    );
    expect(await post(wire(npo, { wire_date: "2026-02-31" }))).toEqual(
      refused(400, "Check the wire date")
    );
    expect(await post(wire(npo, { provider_tx_id: "  " }))).toEqual(
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
    expect(await post(wire(npo, { amount_sent: "100" }))).toEqual(
      refused(400, "Check the amount sent")
    );
    expect(await post(wire(npo, { npo_id: 1.5 }))).toEqual(
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
});
