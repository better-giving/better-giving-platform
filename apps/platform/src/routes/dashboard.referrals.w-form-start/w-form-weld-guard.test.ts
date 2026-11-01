import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

// --- mocks (hoisted) ---

const session = vi.hoisted(() => ({
  user: { id: "user-1", email: "one@example.com" },
}));

const minted = vi.hoisted(() => ({
  eid: undefined as string | null | undefined,
}));

const user_w_form_weld_eid = vi.hoisted(() => vi.fn());
const user_w_form_weld_eid_set = vi.hoisted(() => vi.fn());
const user_update = vi.hoisted(() => vi.fn());
const weld_data_fn = vi.hoisted(() => vi.fn());
const weld_fn = vi.hoisted(() => vi.fn());
const weld_data_create = vi.hoisted(() => vi.fn());

vi.mock("#/.server/auth", () => ({ user_ctx: Symbol("user_ctx") }));

vi.mock("$/pg/queries/user", () => ({
  user_update,
  user_w_form_weld_eid,
  user_w_form_weld_eid_set,
}));

vi.mock("#/.server/registration/weld-data", () => ({
  weld_data_fn,
  weld_data_create,
  weld_fn,
}));

// --- imports (after mocks hoisted) ---

import { loader } from "#/routes/dashboard.referrals.w-form-signed/api";
import { action } from "./api";

const OWNER = { id: "user-1", email: "one@example.com" };
const OTHER = { id: "user-2", email: "two@example.com" };

const MINE = "weld-data-mine";
const THEIRS = "weld-data-theirs";
const DOC = "doc-group-1";
const CONTINUE = "https://app.useanvil.com/form/bg/irs-w9/weld-data-mine";

beforeEach(() => {
  vi.clearAllMocks();
  session.user = { ...OWNER };
  minted.eid = undefined;
  user_w_form_weld_eid.mockImplementation(async () => minted.eid);
  weld_data_fn.mockResolvedValue({ documentGroup: { eid: DOC } });
  weld_fn.mockResolvedValue({ eid: "weld-1" });
  weld_data_create.mockResolvedValue({ eid: MINE, continueURL: CONTINUE });
});

const signed = (weld_data_eid?: string) => {
  const q = weld_data_eid ? `?weldDataEid=${weld_data_eid}` : "";
  return (loader as any)({
    ...doc_args(
      new Request(`https://app.test/dashboard/referrals/w-form-signed${q}`)
    ),
    params: {},
    context: { get: () => session.user },
  });
};

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof Response) return e.status;
    throw e;
  }
};

describe("w-9 callback", () => {
  it("refuses a weld-data eid this session was never sent to", async () => {
    // the weld url is public and anonymous — the eid in the callback is the
    // only claim of authorship, so a signed-in stranger could otherwise file
    // someone else's taxpayer id under their own row and download it.
    session.user = { ...OTHER };
    minted.eid = MINE;

    expect(await status(signed(THEIRS))).toBe(403);

    expect(weld_data_fn).not.toHaveBeenCalled();
    expect(user_update).not.toHaveBeenCalled();
  });

  it("completes for the session the submission was minted for", async () => {
    minted.eid = MINE;

    const data = await signed(MINE);

    expect(weld_data_fn).toHaveBeenCalledWith(MINE);
    // `w_form` keeps its meaning: the document group, which is what the
    // download route authorizes against — not the weld-data eid.
    expect(user_update).toHaveBeenCalledWith(OWNER.email, { w_form: DOC });
    expect(data).toEqual({ doc_eid: DOC });
  });

  it("refuses a user who was never sent to the form", async () => {
    minted.eid = null;

    expect(await status(signed(THEIRS))).toBe(403);
    expect(weld_data_fn).not.toHaveBeenCalled();
    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses a session whose user row is gone", async () => {
    minted.eid = undefined;

    expect(await status(signed(MINE))).toBe(403);
    expect(weld_data_fn).not.toHaveBeenCalled();
    expect(user_update).not.toHaveBeenCalled();
  });

  it("reports an unfinished submission rather than crashing", async () => {
    // the eid is valid from the moment it is minted, so the signer's own
    // in-flight weld now passes the guard — anvil has no document group for it
    // until they finish
    minted.eid = MINE;
    weld_data_fn.mockResolvedValue({ documentGroup: null });

    expect(await status(signed(MINE))).toBe(409);
    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses a callback with no eid at all", async () => {
    minted.eid = MINE;

    expect(await status(signed())).toBe(400);
    // an empty param is not a lookup — nothing is read before it is rejected
    expect(user_w_form_weld_eid).not.toHaveBeenCalled();
    expect(weld_data_fn).not.toHaveBeenCalled();
  });
});

const start = (tax_form?: string) =>
  (action as any)({
    ...doc_args(
      new Request("https://app.test/dashboard/referrals/w-form-start", {
        method: "POST",
        body: new URLSearchParams(tax_form ? { tax_form } : {}),
      })
    ),
    params: {},
    context: { get: () => session.user },
  });

describe("w-9 mint", () => {
  it("records the minted eid against the session user, then sends them on", async () => {
    const res = await start("irs-w9");

    expect(weld_fn).toHaveBeenCalledWith("irs-w9");
    expect(weld_data_create).toHaveBeenCalledWith("weld-1");
    expect(user_w_form_weld_eid_set).toHaveBeenCalledWith(OWNER.email, MINE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(CONTINUE);
  });

  it("does not send the signer on when recording the eid failed", async () => {
    // the write is what the callback verifies against: a signer who reaches
    // anvil without it hands over a taxpayer id for a document they can never
    // claim. so the redirect waits on the write and fails with it.
    user_w_form_weld_eid_set.mockRejectedValueOnce(new Error("pg down"));

    await expect(start("irs-w9")).rejects.toThrow("pg down");
  });

  it("mints the w-8ben weld for a non-us signer", async () => {
    await start("fw8ben");

    expect(weld_fn).toHaveBeenCalledWith("fw8ben");
  });

  it("refuses a form kind that is not one of the two", async () => {
    // the posted value only ever selects a known slug — anvil is never handed
    // a string off the request
    expect(await status(start("../../someone-elses-weld"))).toBe(400);

    expect(weld_fn).not.toHaveBeenCalled();
    expect(weld_data_create).not.toHaveBeenCalled();
    expect(user_w_form_weld_eid_set).not.toHaveBeenCalled();
  });

  it("refuses a post with no form kind", async () => {
    expect(await status(start())).toBe(400);

    expect(weld_fn).not.toHaveBeenCalled();
    expect(user_w_form_weld_eid_set).not.toHaveBeenCalled();
  });
});
