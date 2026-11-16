import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks (hoisted) ---

const q = vi.hoisted(() => ({
  bapp_get: vi.fn(),
  bapp_set_default: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("$/pg/queries/banking", () => ({
  bapp_get: q.bapp_get,
  bapp_set_default: q.bapp_set_default,
}));
vi.mock("$/kit/queue", () => ({ enqueue: q.enqueue }));
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/own-accounts", () => own);
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
  dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
}));

// --- imports (after mocks hoisted) ---

import { admin_ctx } from "#/.server/auth";
import { default_action, loader } from "./api";

const OWN_NPO = 11;
const OTHER_NPO = 22;
const BANK_ID = 7;

const call = () =>
  (default_action as any)({
    request: new Request(
      `https://app.test/admin/${OWN_NPO}/banking/${BANK_ID}`,
      { method: "POST" }
    ),
    params: { id: String(OWN_NPO), bank_id: String(BANK_ID) },
    context: { get: (k: unknown) => (k === admin_ctx ? OWN_NPO : undefined) },
  });

const row = (o: { npo_id?: number; status: string }) => ({
  id: String(BANK_ID),
  npo_id: OWN_NPO,
  ...o,
});

beforeEach(() => {
  for (const f of Object.values(q)) f.mockReset();
  q.bapp_set_default.mockResolvedValue(true);
  wise.v2_account.mockReset().mockResolvedValue({ currency: "USD" });
  own.is_own_recipient.mockReset().mockResolvedValue(false);
});

describe("set default payout method", () => {
  it("refuses, announcing nothing, when the method stopped qualifying after the check", async () => {
    q.bapp_get.mockResolvedValue(row({ status: "approved" }));
    q.bapp_set_default.mockResolvedValue(false);

    const res = await call();

    expect(res).toEqual({ error: expect.stringMatching(/approved/i) });
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it("promotes an approved method of the member's own nonprofit", async () => {
    q.bapp_get.mockResolvedValue(row({ status: "approved" }));

    await call();

    expect(q.bapp_set_default).toHaveBeenCalledWith(String(BANK_ID), OWN_NPO);
    expect(q.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { npo_id: OWN_NPO } })
    );
  });

  it("tells the admin another nonprofit's method is not found and promotes nothing", async () => {
    q.bapp_get.mockResolvedValue(
      row({ npo_id: OTHER_NPO, status: "approved" })
    );

    const res = await call();

    expect(res).toEqual({ error: expect.stringMatching(/not found/i) });
    expect(q.bapp_set_default).not.toHaveBeenCalled();
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it.each(["under-review", "rejected"])(
    "tells the admin a method that is %s can't be default, promoting nothing",
    async (status) => {
      q.bapp_get.mockResolvedValue(row({ status }));

      const res = await call();

      expect(res).toEqual({ error: expect.stringMatching(/approved/i) });
      expect(q.bapp_set_default).not.toHaveBeenCalled();
      expect(q.enqueue).not.toHaveBeenCalled();
    }
  );

  it("treats an already-default method as done without re-promoting", async () => {
    q.bapp_get.mockResolvedValue(row({ status: "default" }));

    const res = await call();

    expect(res).toEqual({ toast: expect.any(String) });
    expect(q.bapp_set_default).not.toHaveBeenCalled();
    expect(q.enqueue).not.toHaveBeenCalled();
  });
});

describe("payout method detail", () => {
  const read = (bank_id = String(BANK_ID)) =>
    (loader as any)({
      request: new Request(
        `https://app.test/admin/${OWN_NPO}/banking/${bank_id}`
      ),
      params: { id: String(OWN_NPO), bank_id },
      context: { get: (k: unknown) => (k === admin_ctx ? OWN_NPO : undefined) },
    });

  // a returned Response reaches the page as its data, which then reads
  // `ba.status` off the body text
  it("throws a 404 for another nonprofit's method", async () => {
    q.bapp_get.mockResolvedValue(
      row({ npo_id: OTHER_NPO, status: "approved" })
    );

    await expect(read()).rejects.toMatchObject({ status: 404 });
  });

  it("throws a 404 for a method that doesn't exist", async () => {
    q.bapp_get.mockResolvedValue(undefined);

    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
});

describe("payout method detail: own-account flag", () => {
  const read = () =>
    (loader as any)({
      request: new Request(
        `https://app.test/admin/${OWN_NPO}/banking/${BANK_ID}`
      ),
      params: { id: String(OWN_NPO), bank_id: String(BANK_ID) },
      context: { get: (k: unknown) => (k === admin_ctx ? OWN_NPO : undefined) },
    });

  it.each([
    [
      "a confirmed match",
      () => own.is_own_recipient.mockResolvedValue(true),
      true,
    ],
    ["no match", () => own.is_own_recipient.mockResolvedValue(false), false],
    [
      "a check that could not run",
      () => own.is_own_recipient.mockRejectedValue(new Error("503")),
      false,
    ],
    [
      "an account wise could not return",
      () => wise.v2_account.mockRejectedValue(new Error("503")),
      false,
    ],
  ])("is %s -> own_account %s", async (_name, arrange, expected) => {
    q.bapp_get.mockResolvedValue(row({ status: "under-review" }));
    arrange();

    const data = await read();

    expect(data.own_account).toBe(expected);
  });

  it("flags a match for every status, so the warning shows while it applies", async () => {
    own.is_own_recipient.mockResolvedValue(true);
    for (const status of ["under-review", "approved", "default", "rejected"]) {
      q.bapp_get.mockResolvedValue(row({ status }));
      expect((await read()).own_account).toBe(true);
    }
  });
});

describe("set default with a malformed id", () => {
  it("throws a 400 and touches nothing", async () => {
    const res = (default_action as any)({
      request: new Request(`https://app.test/admin/${OWN_NPO}/banking/x`, {
        method: "POST",
      }),
      params: { id: String(OWN_NPO), bank_id: "x" },
      context: { get: (k: unknown) => (k === admin_ctx ? OWN_NPO : undefined) },
    });

    await expect(res).rejects.toMatchObject({ status: 400 });
    expect(q.bapp_get).not.toHaveBeenCalled();
  });
});
