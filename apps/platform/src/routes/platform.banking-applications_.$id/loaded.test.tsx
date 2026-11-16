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
  own_account_unknown: false,
  ...o,
});

const render_page = (d: LoaderData) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Loaded {...d} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

const OWN_TITLE = "This matches one of Better Giving's own bank accounts";
const UNKNOWN_TITLE =
  "We couldn't check this account against Better Giving's own accounts";

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

  test("a match is warned about before a verdict, and Approve stays enabled", async () => {
    const screen = await render_page(data({ own_account: true }));
    await expect
      .element(screen.getByRole("region", { name: OWN_TITLE }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Payouts to it may not reach the nonprofit. You can still approve it."
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "false");
  });

  test("a decided application on a match still warns, without the approval sentence", async () => {
    const d = data({ own_account: true });
    for (const status of ["approved", "rejected"] as const) {
      const screen = await render_page({ ...d, ba: { ...d.ba, status } });
      await expect
        .element(screen.getByRole("region", { name: OWN_TITLE }))
        .toBeVisible();
      await expect
        .element(
          screen.getByText("Payouts to it may not reach the nonprofit.", {
            exact: true,
          })
        )
        .toBeVisible();
      expect(screen.getByText(/You can still approve it/).query()).toBeNull();
      await screen.unmount();
    }
  });

  test("a check that could not run says so before a verdict, and Approve stays enabled", async () => {
    const screen = await render_page(data({ own_account_unknown: true }));
    await expect
      .element(screen.getByRole("region", { name: UNKNOWN_TITLE }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "It may be one of ours. Reload to try again, or approve it if you've confirmed it's the nonprofit's own account."
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "false");
  });

  test("a check that could not run says nothing after a verdict", async () => {
    const d = data({ own_account_unknown: true });
    const screen = await render_page({
      ...d,
      ba: { ...d.ba, status: "approved" },
    });
    await expect.element(screen.getByText("Recipient name")).toBeVisible();
    expect(screen.getByRole("region").query()).toBeNull();
  });

  test("no wise rows while wise is unreachable", async () => {
    const screen = await render_page(data({ wacc_unavailable: true }));
    await expect
      .element(screen.getByText("Bank statement", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Recipient name").query()).toBeNull();
  });

  test("an application with no statement on file shows no statement row or link", async () => {
    const d = data({});
    const screen = await render_page({
      ...d,
      ba: { ...d.ba, bank_statement_url: "" },
    });
    await expect
      .element(screen.getByText("Currency", { exact: true }))
      .toBeVisible();
    expect(
      screen.getByText("Bank statement", { exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /s\.pdf|statement/i }).query()
    ).toBeNull();
  });

  test("a statement on file shows its link", async () => {
    const screen = await render_page(data({}));
    await expect
      .element(screen.getByText("Bank statement", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /s\.pdf/ }))
      .toBeVisible();
  });
});
