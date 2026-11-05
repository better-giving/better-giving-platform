import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const reg_get = vi.hoisted(() => vi.fn());
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));

vi.mock("$/pg/queries/registration", () => ({
  reg_get,
  reg_update_from: vi.fn(),
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn(), in_dedupe_window: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_degraded_null: () => null }));
vi.mock("./npo-new", () => ({ npo_new: vi.fn(), announce_approval: vi.fn() }));

import { loader } from "./route";

const REG_ID = "e0000000-0000-4000-8000-0000000000a1";
const DETAIL = `/platform/applications/${REG_ID}`;

const call = (verdict: string) => {
  const request = new Request(`http://x${DETAIL}/${verdict}`);
  return (loader as any)({
    ...doc_args(request),
    params: { id: REG_ID, verdict },
  });
};

/** the thrown or returned redirect's target, or null when the prompt renders */
const redirected_to = async (verdict: string) => {
  const r: unknown = await call(verdict).catch((e: unknown) => e);
  if (!(r instanceof Response)) return null;
  expect(r.status).toBe(302);
  return r.headers.get("location");
};

const reg = (o: Record<string, unknown>) => ({
  id: REG_ID,
  status: "02",
  o_name: "Test NPO",
  o_bank_id: "777",
  ...o,
});

beforeEach(() => {
  reg_get.mockReset();
  wise.v2_account.mockReset();
  wise.v2_account.mockResolvedValue({ id: 777, currency: "USD" });
});

describe("the approve prompt opened by URL", () => {
  it("renders for an application in review with bank details", async () => {
    reg_get.mockResolvedValue(reg({}));

    expect(await redirected_to("approved")).toBeNull();
  });

  it.each(["03", "04"])(
    "sends an application already decided (status %s) back to its detail page",
    async (status) => {
      reg_get.mockResolvedValue(reg({ status }));

      expect(await redirected_to("approved")).toBe(DETAIL);
    }
  );

  it("sends an application with no bank account on file back to its detail page", async () => {
    reg_get.mockResolvedValue(reg({ o_bank_id: null }));

    expect(await redirected_to("approved")).toBe(DETAIL);
  });

  it("renders for a stripe-only application without reading wise", async () => {
    reg_get.mockResolvedValue(
      reg({ o_bank_id: null, o_stripe_account_id: "acct_1" })
    );

    expect(await redirected_to("approved")).toBeNull();
    expect(wise.v2_account).not.toHaveBeenCalled();
  });

  it("sends an application whose account wise can't return back to its detail page", async () => {
    reg_get.mockResolvedValue(reg({}));
    wise.v2_account.mockRejectedValue(new Error("wise is down"));

    expect(await redirected_to("approved")).toBe(DETAIL);
  });
});

describe("the reject prompt opened by URL", () => {
  it("renders without reading the account, even when wise is down", async () => {
    reg_get.mockResolvedValue(reg({ o_bank_id: null }));
    wise.v2_account.mockRejectedValue(new Error("wise is down"));

    expect(await redirected_to("rejected")).toBeNull();
  });
});
