import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import Page from "./route";

// the page renders loader data handed in by the stub; the real loader reaches
// auth, wise and pg, none of which this page's rendering depends on
vi.mock("./api", () => ({ loader: vi.fn(), default_action: vi.fn() }));

const ba = {
  id: "40001",
  npo_id: 7,
  bank_summary: "Chase ****4821",
  bank_statement_url: "https://example.com/s.pdf",
  date_created: "2026-11-10T00:00:00.000Z",
  updated_at: "2026-11-11T00:00:00.000Z",
  status: "approved",
  rejection_reason: "",
};

const render_page = (o: Partial<typeof ba>) => {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/banking/:bank_id",
      Component: Page as any,
      loader: () => ({
        id: 40001,
        ba: { ...ba, ...o },
        currency: "USD",
        country: "US",
        wacc_unavailable: false,
      }),
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={["/admin/7/banking/40001"]} />);
};

describe("npo bank account detail — bank statement row", () => {
  test("an account with no statement on file shows no statement row or link", async () => {
    const screen = await render_page({ bank_statement_url: "" });
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
    const screen = await render_page({});
    await expect
      .element(screen.getByText("Bank statement", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /s\.pdf/ }))
      .toBeVisible();
  });
});
