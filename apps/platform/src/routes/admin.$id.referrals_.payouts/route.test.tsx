import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const npo_get = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/npo", async (orig) => ({
  ...(await orig<object>()),
  npo_get,
}));
const referrer_payout_list = vi.hoisted(() => vi.fn());
const referrer_owed_history = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/referrer", async (orig) => ({
  ...(await orig<object>()),
  referrer_payout_list,
}));
vi.mock("$/pg/queries/owed-history", async (orig) => ({
  ...(await orig<object>()),
  referrer_owed_history,
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import { admin_ctx } from "$/auth/test-utils";
import { loader } from "./api";
import Page from "./route";

const NPO_ID = 7;

describe("referral payouts of a nonprofit whose referral ID isn't issued yet", () => {
  it("tells the admin the link isn't set up instead of failing the page", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: null });

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals/payouts",
        Component: Page as any,
        loader: loader as any,
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, NPO_ID);
            return next();
          },
        ],
      },
    ]);
    const screen = await render(
      <Stub
        initialEntries={[`/admin/${NPO_ID}/referrals/payouts`]}
        future={{ v8_middleware: true }}
      />
    );

    await expect
      .element(
        screen.getByText(
          "Your referral link isn't set up yet. Check back soon or contact support."
        )
      )
      .toBeVisible();
  });

  it("lists the payouts and owed history once the nonprofit has a referral ID", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: "NPO-REF-77" });
    referrer_payout_list.mockResolvedValue({
      items: [{ date: "2026-03-05T12:00:00.000Z", amount: 42, error: false }],
    });
    referrer_owed_history.mockResolvedValue([]);

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals/payouts",
        Component: Page as any,
        loader: loader as any,
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, NPO_ID);
            return next();
          },
        ],
      },
    ]);
    const screen = await render(
      <Stub
        initialEntries={[`/admin/${NPO_ID}/referrals/payouts`]}
        future={{ v8_middleware: true }}
      />
    );

    await expect.element(screen.getByText("$42.00")).toBeVisible();
    await expect
      .element(screen.getByRole("heading", { name: "Amounts owed" }))
      .toBeVisible();
    expect(referrer_payout_list).toHaveBeenCalledWith(
      "NPO-REF-77",
      expect.objectContaining({ limit: 8 })
    );
    expect(screen.getByText("isn't set up yet").query()).toBeNull();
  });
});
