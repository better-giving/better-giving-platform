import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const q = vi.hoisted(() => ({
  bapp_approve: vi.fn(),
  bapp_get: vi.fn(),
  bapp_update_status: vi.fn(),
  npo_default_bapp: vi.fn(),
  npo_legal_names: vi.fn(),
}));
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));

vi.mock("$/pg/queries/banking", () => q);
vi.mock("$/pg/queries/npo", () => ({ npos_batch_get: async () => [] }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/own-accounts", () => own);
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

const LEGAL = "Harbor Light Food Pantry";

const bapp = (status: string, account_holder: string | null = LEGAL) => ({
  id: String(BAPP_ID),
  npo_id: 7,
  status,
  account_holder,
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
  wise.v2_account.mockResolvedValue({
    id: BAPP_ID,
    currency: "USD",
    name: { fullName: "Harbor Light Food Pantry Inc." },
  });
  q.npo_legal_names.mockResolvedValue(new Map([[7, LEGAL]]));
  own.is_own_recipient.mockReset().mockResolvedValue(false);
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

const submit = (type: "approved" | "rejected", extra = {}) => {
  form.data = type === "approved" ? { type, ...extra } : { type, reason: "no" };
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
    q.npo_default_bapp.mockResolvedValue({ id: "39999", status: "default" });
    q.bapp_approve.mockResolvedValue({ status: "under-review" });

    await submit("approved");

    expect(q.bapp_approve).toHaveBeenCalledWith(String(BAPP_ID), 7);
  });

  it("still lets a reject through while wise is down", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    wise.v2_account.mockRejectedValue(new Error("wise down"));
    q.bapp_update_status.mockResolvedValue({ status: "under-review" });

    await submit("rejected");

    expect(q.bapp_update_status).toHaveBeenCalled();
  });

  it("refuses with 409 and writes nothing when the account is one of Better Giving's own", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    own.is_own_recipient.mockResolvedValue(true);

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect((r as Response).status).toBe(409);
    expect(await (r as Response).text()).toMatch(/belongs to Better Giving/);
    expect(q.bapp_approve).not.toHaveBeenCalled();
  });

  it("refuses with 409 and writes nothing when our own accounts can't be read", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review"));
    own.is_own_recipient.mockRejectedValue(new Error("account-details 503"));

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect((r as Response).status).toBe(409);
    expect(q.bapp_approve).not.toHaveBeenCalled();
  });

  it("refuses a holder name that isn't the nonprofit's legal name without confirmation", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review", "Dana Whitfield"));

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect((r as Response).status).toBe(409);
    expect(await (r as Response).text()).toMatch(/Dana Whitfield/);
    expect(q.bapp_approve).not.toHaveBeenCalled();
  });

  it("approves a holder name that isn't the legal name once the reviewer confirms it", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review", "Dana Whitfield"));
    q.bapp_approve.mockResolvedValue({ status: "under-review" });

    await submit("approved", { confirm_holder: true });

    expect(q.bapp_approve).toHaveBeenCalledWith(String(BAPP_ID), 7);
  });

  it("reads the holder from wise when none is stored, and holds a mismatch to confirmation", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review", null));
    wise.v2_account.mockResolvedValue({
      id: BAPP_ID,
      currency: "USD",
      name: { fullName: "Dana Whitfield" },
    });

    const r: unknown = await submit("approved").catch((e: unknown) => e);

    expect((r as Response).status).toBe(409);
    expect(q.bapp_approve).not.toHaveBeenCalled();
  });

  it("approves without confirmation when no holder is known at all", async () => {
    q.bapp_get.mockResolvedValue(bapp("under-review", null));
    wise.v2_account.mockResolvedValue({ id: BAPP_ID, currency: "USD" });
    q.bapp_approve.mockResolvedValue({ status: "under-review" });

    await submit("approved");

    expect(q.bapp_approve).toHaveBeenCalledWith(String(BAPP_ID), 7);
  });
});
