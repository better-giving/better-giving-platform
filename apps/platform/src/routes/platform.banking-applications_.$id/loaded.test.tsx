import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";
import { Loaded } from "./loaded";

const data = (o: Partial<LoaderData>): LoaderData => ({
  ba: {
    id: "40001",
    npo_id: 7,
    bank_summary: "Chase ****4821",
    bank_statement_url: "https://example.com/s.pdf",
    date_created: "2026-11-10T00:00:00.000Z",
    updated_at: "2026-11-11T00:00:00.000Z",
    status: "under-review",
    rejection_reason: "",
  },
  id: 40001,
  currency: "USD",
  country: "US",
  wacc_unavailable: false,
  npo_name: "Riverbend Youth Coding Collective",
  name: { fullName: "Harbor Light Food Pantry Inc." },
  own_account: false,
  ...o,
});

const render_page = (d: LoaderData) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Loaded {...d} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

const OWN_TITLE = "This is Better Giving's own bank account";

describe("banking application review — Better Giving's own account", () => {
  test("a regular account has no callout and shows its recipient name", async () => {
    const screen = await render_page(data({}));
    await expect
      .element(screen.getByText("Recipient name", { exact: true }))
      .toBeVisible();
    expect(screen.getByRole("region").query()).toBeNull();
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "false");
  });

  test("Better Giving's own account is called out and can't be approved", async () => {
    const screen = await render_page(data({ own_account: true }));
    await expect
      .element(screen.getByRole("region", { name: OWN_TITLE }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  test("a decided application on Better Giving's own account still calls it out", async () => {
    const d = data({ own_account: true });
    const screen = await render_page({
      ...d,
      ba: { ...d.ba, status: "approved" },
    });
    await expect
      .element(screen.getByRole("region", { name: OWN_TITLE }))
      .toBeVisible();
  });

  test("a decided application on Better Giving's own account drops the approval sentence", async () => {
    const d = data({ own_account: true });
    const decided = await render_page({
      ...d,
      ba: { ...d.ba, status: "rejected" },
    });
    await expect
      .element(decided.getByText("Payouts to it never reach the nonprofit."))
      .toBeVisible();
    expect(decided.getByText("so it can't be approved").query()).toBeNull();
  });

  test("an under-review application on Better Giving's own account says it can't be approved", async () => {
    const screen = await render_page(data({ own_account: true }));
    await expect
      .element(screen.getByText(/so it can't be approved/))
      .toBeVisible();
  });

  test("no wise rows while wise is unreachable", async () => {
    const screen = await render_page(data({ wacc_unavailable: true }));
    await expect
      .element(screen.getByText("Bank statement", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Recipient name").query()).toBeNull();
  });
});
