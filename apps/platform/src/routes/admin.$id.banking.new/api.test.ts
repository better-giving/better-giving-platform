import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks (hoisted) ---

const q = vi.hoisted(() => ({
  bapp_get: vi.fn(),
  bapp_put: vi.fn(),
  npo_bapp_count: vi.fn(),
  enqueue: vi.fn(),
}));
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));

vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/own-accounts", () => own);
vi.mock("#/errors/report", () => ({ report_degraded_null: () => null }));
vi.mock("$/pg/queries/banking", () => ({
  bapp_get: q.bapp_get,
  bapp_put: q.bapp_put,
  npo_bapp_count: q.npo_bapp_count,
}));
vi.mock("$/kit/queue", () => ({ enqueue: q.enqueue }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);
vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return { redirectWithSuccess: vi.fn((url: string) => redirect(url)) };
});

// --- imports (after mocks hoisted) ---

import { admin_ctx } from "#/.server/auth";
import { action } from "./api";

const OWN_NPO = 11;
const OTHER_NPO = 22;

const call = (body: object) =>
  (action as any)({
    request: new Request(`https://app.test/admin/${OWN_NPO}/banking/new`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: String(OWN_NPO) },
    context: { get: (k: unknown) => (k === admin_ctx ? OWN_NPO : undefined) },
  });

const body = (endowmentID: number) => ({
  wiseRecipientID: "40000001",
  endowmentID,
  bankSummary: "USD account ending in 1234",
  bankStatementFile: { name: "s.pdf", publicUrl: "https://x.test/s.pdf" },
});

beforeEach(() => {
  for (const f of Object.values(q)) f.mockReset();
  q.npo_bapp_count.mockResolvedValue(0);
  q.bapp_put.mockResolvedValue(true);
  wise.v2_account.mockReset().mockResolvedValue({
    id: 40000001,
    name: { fullName: "Harbor Light Food Pantry Inc." },
  });
  own.is_own_recipient.mockReset().mockResolvedValue(false);
});

describe("new banking application", () => {
  it("files the application on the nonprofit the member administers", async () => {
    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(302);
    expect(q.npo_bapp_count).toHaveBeenCalledWith(OWN_NPO);
    expect(q.bapp_put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ npo_id: OWN_NPO, status: "under-review" })
    );
    expect(q.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { npo_id: OWN_NPO } })
    );
  });

  it("re-sends the notice on a retried submit, which the dedupe id collapses", async () => {
    q.bapp_put.mockResolvedValue(false);
    q.bapp_get.mockResolvedValue({
      id: "40000001",
      npo_id: OWN_NPO,
      status: "under-review",
    });

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(302);
    expect(q.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { npo_id: OWN_NPO } })
    );
  });

  it("lets a retried 10th submit through the method cap", async () => {
    q.npo_bapp_count.mockResolvedValue(10);
    q.bapp_get.mockResolvedValue({
      id: "40000001",
      npo_id: OWN_NPO,
      status: "under-review",
    });

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(302);
    expect(q.bapp_put).not.toHaveBeenCalled();
    expect(q.enqueue).toHaveBeenCalledOnce();
  });

  it("refuses an 11th payout method", async () => {
    q.npo_bapp_count.mockResolvedValue(10);

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: /max 10/i });
    expect(q.bapp_put).not.toHaveBeenCalled();
  });

  it("refuses a resubmit of a rejected account, pointing to support or other details", async () => {
    q.bapp_put.mockResolvedValue(false);
    q.bapp_get.mockResolvedValue({
      id: "40000001",
      npo_id: OWN_NPO,
      status: "rejected",
    });

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(409);
    const { message } = await res.json();
    expect(message).toMatch(/was rejected/i);
    expect(message).toMatch(/contact support|different account/i);
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it.each(["approved", "default"])(
    "refuses a resubmit of an account already %s instead of reporting it filed",
    async (status) => {
      q.bapp_put.mockResolvedValue(false);
      q.bapp_get.mockResolvedValue({ id: "40000001", npo_id: OWN_NPO, status });

      const res: Response = await call(body(OWN_NPO));

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ message: /already on file/i });
      expect(q.enqueue).not.toHaveBeenCalled();
    }
  );

  it("refuses with 409 a recipient already filed by another nonprofit", async () => {
    q.bapp_put.mockResolvedValue(false);
    q.bapp_get.mockResolvedValue({ id: "40000001", npo_id: OTHER_NPO });

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(409);
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a body naming another nonprofit with 403 and writes nothing", async () => {
    const res: Response = await call(body(OTHER_NPO));

    expect(res.status).toBe(403);
    expect(q.bapp_put).not.toHaveBeenCalled();
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it("stores the holder name wise returns for the recipient, never one from the body", async () => {
    const res: Response = await call({
      ...body(OWN_NPO),
      accountHolderName: "Someone Else",
    });

    expect(res.status).toBe(302);
    expect(wise.v2_account).toHaveBeenCalledWith(40000001);
    expect(q.bapp_put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        account_holder: "Harbor Light Food Pantry Inc.",
      })
    );
  });

  it("files the application with no holder when wise can't be reached", async () => {
    wise.v2_account.mockRejectedValue(new Error("wise down"));

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(302);
    expect(q.bapp_put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ account_holder: null })
    );
  });

  it("refuses with 409 an account that is one of Better Giving's own, and files nothing", async () => {
    own.is_own_recipient.mockResolvedValue(true);

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      message: /belongs to Better Giving/i,
    });
    expect(q.bapp_put).not.toHaveBeenCalled();
  });

  it("still files when our own accounts can't be read: approval checks again", async () => {
    own.is_own_recipient.mockRejectedValue(new Error("account-details 503"));

    const res: Response = await call(body(OWN_NPO));

    expect(res.status).toBe(302);
    expect(q.bapp_put).toHaveBeenCalled();
  });
});
