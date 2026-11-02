import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import type { PaymentRow } from "../api";
import Page from "../route";

afterEach(async () => {
  await cleanup();
});

const base: PaymentRow = {
  id: "don_1",
  donation_id: "don_1",
  amount_base: 100,
  amount_tip: 0,
  amount_fee_allowance: 0,
  currency: "USD",
  email: "ada@test.com",
  company_name: "Northwind Traders",
  npo_name: "Freegan Food Foundation",
  sttl_fee: null,
  sttl_currency: null,
  // crypto: the processor-side refund this void exists to record, and a row
  // with no Refund link of its own to confuse the assertion
  via: "crypto:eth",
  created_at: new Date("2026-01-01").toISOString(),
  status: "settled",
  match_event_id: null,
  match_pack_sent_at: null,
  match_chased_at: null,
  match_submitted_at: null,
  match_voided_at: null,
  match_void_reason: null,
  match_send_failed_kind: null,
};

const items: PaymentRow[] = [
  base,
  {
    ...base,
    id: "don_2",
    donation_id: "don_2",
    match_event_id: "evt_2",
    match_pack_sent_at: new Date("2026-01-02").toISOString(),
  },
  {
    ...base,
    id: "don_3",
    donation_id: "don_3",
    match_event_id: "evt_3",
    match_pack_sent_at: new Date("2026-01-02").toISOString(),
    match_voided_at: new Date("2026-01-03").toISOString(),
    match_void_reason: "refunded",
  },
];

function render_list(rows = items) {
  const Stub = createRoutesStub([
    {
      path: "/platform/donations",
      Component: Page,
      HydrateFallback: () => null,
      loader: () => ({ items: rows, next: undefined }),
    },
  ]);
  return render(<Stub initialEntries={["/platform/donations"]} />);
}

describe("donations table — match cell", () => {
  it("offers the void only where an unvoided event exists", async () => {
    const screen = await render_list();

    await expect
      .element(screen.getByRole("link", { name: "Void" }))
      .toBeInTheDocument();

    const links = screen.getByRole("link", { name: "Void" }).elements();
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toContain("don_2/void-match");
  });
});

describe("donations table — method cell", () => {
  it.each([
    ["crypto:eth", "crypto:eth"],
    ["stripe:card", "Card"],
    ["paypal:paypal", "PayPal"],
  ])("a %s gift reads %s", async (via, label) => {
    const screen = await render_list([{ ...base, via }]);

    const row = screen.getByRole("row").nth(1);
    await expect.element(row).toBeVisible();
    const method = row.element().children[7];
    expect(method.textContent).toBe(label);
  });
});
