import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const npos_batch_get = vi.hoisted(() => vi.fn());
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));

vi.mock("$/pg/queries/banking", () => ({
  bapp_get: async () => ({
    id: "40001",
    npo_id: 7,
    status: "under-review",
  }),
  bapp_update_status: vi.fn(),
  npo_bapp_count: vi.fn(),
}));
vi.mock("$/pg/queries/npo", () => ({ npos_batch_get }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/own-accounts", async (io) => ({
  ...(await io<typeof import("$/payouts/own-accounts")>()),
  ...own,
}));
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn() }));
vi.mock("#/.server/toast", () => ({ redirectWithSuccess: vi.fn() }));
vi.mock("#/errors/report", () => ({
  report_degraded_null: () => null,
  report_degraded: vi.fn(),
}));

import { loader } from "./route";

const call = () =>
  (loader as any)({
    ...doc_args(new Request("http://x/platform/banking-applications/40001")),
    params: { id: "40001" },
  });

beforeEach(() => {
  npos_batch_get.mockReset().mockResolvedValue([]);
  wise.v2_account.mockReset().mockResolvedValue({ id: 40001, currency: "USD" });
  own.is_own_recipient.mockReset().mockResolvedValue(false);
});

describe("banking application detail loader", () => {
  it("flags an account that is one of Better Giving's own", async () => {
    own.is_own_recipient.mockResolvedValue(true);

    const d = await call();
    expect(d.own_account).toBe(true);
    expect(d.own_account_unknown).toBe(false);
  });

  it("reads an account it can't check against ours as unknown, not as a match", async () => {
    own.is_own_recipient.mockRejectedValue(new Error("account-details 503"));

    const d = await call();
    expect(d.own_account).toBe(false);
    expect(d.own_account_unknown).toBe(true);
  });

  it("flags an account that isn't one of ours as false", async () => {
    own.is_own_recipient.mockResolvedValue(false);

    const d = await call();
    expect(d.own_account).toBe(false);
    expect(d.own_account_unknown).toBe(false);
  });

  it("an account wise could not return is neither a match nor unknown", async () => {
    wise.v2_account.mockRejectedValue(new Error("wise down"));

    const d = await call();
    expect(d.wacc_unavailable).toBe(true);
    expect(d.own_account).toBe(false);
    expect(d.own_account_unknown).toBe(false);
  });

  it("names the application's nonprofit, and leaves the name out when its row is gone", async () => {
    npos_batch_get.mockResolvedValueOnce([{ id: 7, name: "Acme Relief" }]);
    const named = await call();
    expect(npos_batch_get).toHaveBeenCalledWith([7]);
    expect(named.npo_name).toBe("Acme Relief");
    expect(named.ba.npo_id).toBe(7);

    npos_batch_get.mockResolvedValueOnce([]);
    expect((await call()).npo_name).toBeUndefined();
  });
});
