import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { EarningsHistory as AdminTable } from "#/pages/admin/referrals/earnings-table";
import { EarningsHistory as DonorTable } from "#/pages/user-dashboard/referrals/earnings-table";
import type { INpoDonation } from "$/pg/queries/dist";

const earning = (o: Partial<INpoDonation>) =>
  ({
    id: "d-1",
    date_created: "2026-08-01T00:00:00.000Z",
    to_id: 1,
    to_name: "Test NPO",
    status: "refunded",
    donation_status: "refunded",
    ...o,
  }) as INpoDonation;

describe.each([
  ["admin", AdminTable],
  ["user dashboard", DonorTable],
])("%s referral earnings", (_, Table) => {
  async function tip_of(o: Partial<INpoDonation>) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <Table items={[earning(o)]} />,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);
    const tip = screen.getByRole("button", { name: "More info", exact: true });
    await expect.element(tip).toBeVisible();
    return tip;
  }

  test("a cancelled duplicate says Cancelled, recorded twice, no refund made", async () => {
    const tip = await tip_of({ donation_status: "cancelled" });
    await expect
      .element(tip)
      .toHaveAccessibleDescription(
        "Cancelled Recorded twice. This duplicate was cancelled. No refund was made."
      );
  });

  test("a real refund still says Refunded", async () => {
    const tip = await tip_of({});
    await expect.element(tip).toHaveAccessibleDescription("Refunded");
  });
});
