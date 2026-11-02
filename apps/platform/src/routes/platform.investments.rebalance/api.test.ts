import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks (hoisted) ---

const q = vi.hoisted(() => ({
  nav_ltd: vi.fn(),
  nav_log_put: vi.fn(),
  rebalance_log_put: vi.fn(),
}));

vi.mock("$/pg/queries/nav", () => q);
vi.mock("$/pg/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock("#/.server/toast", () => ({
  dataWithError: vi.fn((_d: unknown, msg: string, init?: ResponseInit) =>
    init ? { error: msg, status: init.status } : { error: msg }
  ),
}));

// --- imports (after mocks hoisted) ---

import { action } from "./api";

const ticker = (id: string, qty: number) => ({
  id,
  qty,
  price: 1,
  value: qty,
  price_date: "2026-09-01T00:00:00.000Z",
});

/** spends 20 CASH on IVV */
const TXS = [
  {
    tx_id: "t1",
    in_id: "IVV",
    out_id: "CASH",
    in_qty: "2",
    out_qty: "20",
    price: "10",
    fee: "",
  },
];

const call = (body: unknown) =>
  (action as any)({
    request: new Request("http://x/platform/investments/rebalance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });

beforeEach(() => {
  for (const f of Object.values(q)) f.mockReset();
});

describe("rebalance", () => {
  it("a review made against balances that have since dropped answers in place and writes nothing", async () => {
    // the page reviewed 100 CASH; only 10 is left
    q.nav_ltd.mockResolvedValue({
      units: 1,
      composition: { CASH: ticker("CASH", 10), IVV: ticker("IVV", 0) },
    });

    const res = await call(TXS);

    expect(res).toEqual({ error: "A ticker's balance would go negative" });
    expect(q.rebalance_log_put).not.toHaveBeenCalled();
    expect(q.nav_log_put).not.toHaveBeenCalled();
  });

  it("a portfolio with no units is refused with a 4xx and writes nothing", async () => {
    q.nav_ltd.mockResolvedValue({
      units: 0,
      composition: { CASH: ticker("CASH", 100), IVV: ticker("IVV", 0) },
    });

    const res = await call(TXS);

    expect(res).toEqual({
      error: "Can't rebalance: the portfolio has no units yet.",
      status: 400,
    });
    expect(q.rebalance_log_put).not.toHaveBeenCalled();
    expect(q.nav_log_put).not.toHaveBeenCalled();
  });

  it("a malformed tx list is refused with 400", async () => {
    q.nav_ltd.mockResolvedValue({
      units: 1,
      composition: { CASH: ticker("CASH", 100) },
    });

    const thrown = await call([]).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(400);
  });
});
