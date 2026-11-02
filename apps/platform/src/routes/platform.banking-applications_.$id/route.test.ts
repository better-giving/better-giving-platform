import { describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const npos_batch_get = vi.hoisted(() => vi.fn());

vi.mock("$/pg/queries/banking", () => ({
  bapp_get: async () => ({ id: "40001", npo_id: 7, status: "under-review" }),
  bapp_update_status: vi.fn(),
  npo_bapp_count: vi.fn(),
}));
vi.mock("$/pg/queries/npo", () => ({ npos_batch_get }));
vi.mock("$/kit/wise", () => ({
  wise: { v2_account: async () => ({ id: 40001, currency: "USD" }) },
}));
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn() }));
vi.mock("#/.server/toast", () => ({ redirectWithSuccess: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_degraded_null: () => null }));

import { loader } from "./route";

const call = () =>
  (loader as any)({
    ...doc_args(new Request("http://x/platform/banking-applications/40001")),
    params: { id: "40001" },
  });

describe("banking application detail loader", () => {
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
