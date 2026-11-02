import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const q = vi.hoisted(() => ({
  bapp_get: vi.fn(),
  bapp_update_status: vi.fn(),
  npo_bapp_count: vi.fn(),
}));
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));

vi.mock("$/pg/queries/banking", () => q);
vi.mock("$/pg/queries/npo", () => ({ npos_batch_get: async () => [] }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn() }));
vi.mock("#/.server/toast", () => ({ redirectWithSuccess: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_degraded_null: () => null }));
const form = vi.hoisted(() => ({
  data: { type: "approved" } as Record<string, unknown>,
}));
vi.mock("remix-hook-form", () => ({
  getValidatedFormData: async () => ({ data: form.data }),
}));

import { action, loader } from "./route";

const BAPP_ID = 40001;
const DETAIL = `/platform/banking-applications/${BAPP_ID}`;

const bapp = (status: string) => ({
  id: String(BAPP_ID),
  npo_id: 7,
  status,
  bank_statement_url: "https://example.com/statement.pdf",
  date_created: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
});

const call = () => {
  const request = new Request(`http://x${DETAIL}/approve`);
  return (loader as any)({
    ...doc_args(request),
    params: { id: String(BAPP_ID) },
  });
};

/** the thrown or returned redirect's target, or null when the page renders */
const redirected_to = async () => {
  const r: unknown = await call().catch((e: unknown) => e);
  if (!(r instanceof Response)) return null;
  expect(r.status).toBe(302);
  return r.headers.get("location");
};

beforeEach(() => {
  for (const f of Object.values(q)) f.mockReset();
  wise.v2_account.mockReset();
  wise.v2_account.mockResolvedValue({ id: BAPP_ID, currency: "USD" });
});

describe("the approve prompt opened by URL", () => {
  it("renders for an application under review whose account wise returns", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));

    expect(await redirected_to()).toBeNull();
  });

  it.each(["approved", "default", "rejected"])(
    "sends an application already %s back to its detail page",
    async (status) => {
      q.bapp_get.mockResolvedValue(bapp(status));

      expect(await redirected_to()).toBe(DETAIL);
    }
  );

  it("sends an application whose account wise can't return back to its detail page", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    wise.v2_account.mockRejectedValue(new Error("wise is down"));

    expect(await redirected_to()).toBe(DETAIL);
  });
});

const submit = (type: "approved" | "rejected") => {
  form.data = type === "approved" ? { type } : { type, reason: "no" };
  const request = new Request(`http://x${DETAIL}/approve`, { method: "POST" });
  return (action as any)({ request, params: { id: String(BAPP_ID) } });
};

describe("the approve submit, posted around the page", () => {
  it("refuses and writes nothing when wise cannot show the account", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    wise.v2_account.mockRejectedValue(new Error("wise down"));

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(409);
    expect(q.bapp_update_status).not.toHaveBeenCalled();
  });

  it("refuses and writes nothing when the application is no longer under review", async () => {
    q.bapp_get.mockResolvedValue(bapp("approved"));

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect((r as Response).status).toBe(409);
    expect(q.bapp_update_status).not.toHaveBeenCalled();
  });

  it("approves an application under review whose account wise returns", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    q.npo_bapp_count.mockResolvedValue(2);
    q.bapp_update_status.mockResolvedValue({ status: "under-review" });

    await submit("approved");

    expect(q.bapp_update_status).toHaveBeenCalledWith(String(BAPP_ID), {
      status: "approved",
    });
  });

  it("still lets a reject through while wise is down", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    wise.v2_account.mockRejectedValue(new Error("wise down"));
    q.bapp_update_status.mockResolvedValue({ status: "under-review" });

    await submit("rejected");

    expect(q.bapp_update_status).toHaveBeenCalled();
  });
});
