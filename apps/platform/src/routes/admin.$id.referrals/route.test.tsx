import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const npo_get = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/npo", async (orig) => ({
  ...(await orig<object>()),
  npo_get,
}));
const referred_by = vi.hoisted(() => vi.fn());
const referrer_donations = vi.hoisted(() => vi.fn());
const pending_earnings = vi.hoisted(() => vi.fn());
const payout_ltd_get = vi.hoisted(() => vi.fn());
const npo_default_bapp = vi.hoisted(() => vi.fn());
vi.mock("#/.server/referrals", () => ({ referred_by }));
vi.mock("$/pg/queries/dist", async (orig) => ({
  ...(await orig<object>()),
  referrer_donations,
}));
vi.mock("$/pg/queries/referrer", async (orig) => ({
  ...(await orig<object>()),
  pending_earnings,
  payout_ltd_get,
}));
vi.mock("$/pg/queries/banking", async (orig) => ({
  ...(await orig<object>()),
  npo_default_bapp,
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

describe("referrals of a nonprofit whose referral ID isn't issued yet", () => {
  it("tells the admin the link isn't set up instead of failing the page", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: null });

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals",
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
        initialEntries={[`/admin/${NPO_ID}/referrals`]}
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
    expect(screen.getByText("Earnings", { exact: true }).query()).toBeNull();
  });

  it("shows the issued referral ID, its link and the earnings once the nonprofit has one", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: "NPO-REF-77" });
    referred_by.mockResolvedValue([
      {
        id: 12,
        name: "Harbor Clinic",
        up_until: "2099-01-01",
        ltd: 0,
      },
    ]);
    referrer_donations.mockResolvedValue({ items: [] });
    pending_earnings.mockResolvedValue(0);
    payout_ltd_get.mockResolvedValue(0);
    npo_default_bapp.mockResolvedValue(undefined);

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals",
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
        initialEntries={[`/admin/${NPO_ID}/referrals`]}
        future={{ v8_middleware: true }}
      />
    );

    await expect
      .element(screen.getByText("NPO-REF-77", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("/register?referrer=NPO-REF-77"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("heading", { name: "Earnings", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Harbor Clinic" }))
      .toBeVisible();
    expect(screen.getByText("isn't set up yet").query()).toBeNull();
  });
});
