import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const npo_get = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/npo", async (orig) => ({
  ...(await orig<object>()),
  npo_get,
}));
const referrer_donations = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/dist", async (orig) => ({
  ...(await orig<object>()),
  referrer_donations,
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

describe("referral earnings of a nonprofit whose referral ID isn't issued yet", () => {
  it("tells the admin the link isn't set up instead of failing the page", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: null });

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals/earnings",
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
        initialEntries={[`/admin/${NPO_ID}/referrals/earnings`]}
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

  it("lists the earnings once the nonprofit has a referral ID", async () => {
    npo_get.mockResolvedValue({ id: NPO_ID, referral_id: "NPO-REF-77" });
    referrer_donations.mockResolvedValue({
      items: [
        {
          date_created: "2026-03-05T12:00:00.000Z",
          to_id: 12,
          to_name: "Harbor Clinic",
          status: "settled",
        },
      ],
    });

    const Stub = createRoutesStub([
      {
        path: "/admin/:id/referrals/earnings",
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
        initialEntries={[`/admin/${NPO_ID}/referrals/earnings`]}
        future={{ v8_middleware: true }}
      />
    );

    await expect
      .element(screen.getByRole("link", { name: "Harbor Clinic" }))
      .toBeVisible();
    expect(referrer_donations).toHaveBeenCalledWith(
      "NPO-REF-77",
      expect.objectContaining({ limit: 4 })
    );
    expect(screen.getByText("isn't set up yet").query()).toBeNull();
  });
});
