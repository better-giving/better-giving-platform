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
  company_name: null,
  npo_name: "Freegan Food Foundation",
  sttl_fee: null,
  sttl_currency: null,
  via: "stripe:card",
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

const row = (id: string, over: Partial<PaymentRow>): PaymentRow => ({
  ...base,
  id,
  donation_id: id,
  email: `${id}@test.com`,
  ...over,
});

async function render_page(
  entry: string,
  data: { items: PaymentRow[]; next?: string } = { items: [base] }
) {
  const seen: string[] = [];
  const Stub = createRoutesStub([
    {
      path: "/platform/donations",
      Component: Page,
      HydrateFallback: () => null,
      loader: ({ request }) => {
        seen.push(new URL(request.url).search);
        return data;
      },
    },
  ]);
  const screen = await render(<Stub initialEntries={[entry]} />);
  return { screen, seen };
}

describe("clear filters", () => {
  it("is absent on the defaults", async () => {
    const { screen } = await render_page("/platform/donations");
    await expect
      .element(screen.getByRole("tab", { name: "Settled" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .not.toBeInTheDocument();
  });

  it("is absent for an unknown param value, which falls back", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=x&method=y"
    );
    await expect
      .element(screen.getByRole("tab", { name: "Settled" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .not.toBeInTheDocument();
  });

  it.each(["?status=failed", "?method=crypto"])(
    "shows off the defaults (%s) and resets both",
    async (qs) => {
      const { screen, seen } = await render_page(`/platform/donations${qs}`);
      const clear = screen.getByRole("button", { name: "Clear filters" });
      await expect.element(clear).toBeInTheDocument();
      await clear.click();
      await expect.element(clear).not.toBeInTheDocument();
      await expect
        .element(screen.getByRole("tab", { name: "Settled" }))
        .toHaveAttribute("aria-selected", "true");
      // the default url carries neither param
      await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    }
  );
});

describe("status tabs", () => {
  it("a change writes the param, drops the cursor and omits defaults", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?cursor=abc"
    );
    await screen.getByRole("tab", { name: "Awaiting funds" }).click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?status=awaiting"));
    await screen.getByRole("tab", { name: "Settled" }).click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
  });
});

describe("action column", () => {
  it("offers Refund only on settled stripe rows", async () => {
    const { screen } = await render_page("/platform/donations?status=all", {
      items: [
        row("a", { via: "stripe:card" }),
        row("b", { via: "paypal:paypal" }),
        row("c", { via: "stripe:card", status: "refunded" }),
        row("d", { via: "stripe:card", status: "created" }),
      ],
    });
    const links = screen.getByRole("link", { name: "Refund" });
    await expect.element(links.first()).toBeInTheDocument();
    const els = links.elements();
    expect(els.length).toBe(1);
    expect(els[0]!.getAttribute("href")).toContain("a/refund");
    expect(els[0]!.getAttribute("aria-label")).toBe(
      "Refund donation from a@test.com"
    );
    const n_a = screen.getByText("N/A").elements();
    expect(n_a.length).toBe(3);
  });
});

describe("status tags", () => {
  it.each([
    ["settled", "stripe:card", "Settled"],
    ["intent", "crypto:eth", "Awaiting crypto"],
    ["expired", "stripe:card", "Checkout expired"],
    ["refunded_loss", "paypal:paypal", "Refunded (loss)"],
  ])("%s × %s reads %s", async (status, via, label) => {
    const { screen } = await render_page("/platform/donations?status=all", {
      items: [row("t", { status, via })],
    });
    await expect.element(screen.getByText(label).first()).toBeVisible();
  });
});

describe("paging and empty state", () => {
  it("shows View More only when the loader returns next", async () => {
    const { screen } = await render_page("/platform/donations");
    await expect
      .element(screen.getByRole("cell", { name: "ada@test.com", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "View More" }))
      .not.toBeInTheDocument();
  });

  it("Load more keeps both params and adds the cursor", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?status=awaiting&method=crypto",
      { items: [base], next: "CUR" }
    );
    await screen.getByRole("button", { name: "View More" }).click();
    await vi.waitFor(() => {
      const last = new URLSearchParams(seen.at(-1));
      expect(last.get("status")).toBe("awaiting");
      expect(last.get("method")).toBe("crypto");
      expect(last.get("cursor")).toBe("CUR");
    });
  });

  it("an empty result reads No donations found", async () => {
    const { screen } = await render_page("/platform/donations?status=failed", {
      items: [],
    });
    await expect
      .element(screen.getByText("No donations found"))
      .toBeInTheDocument();
  });
});
