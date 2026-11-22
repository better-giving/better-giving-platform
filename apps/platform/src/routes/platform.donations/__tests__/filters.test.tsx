import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import type { PaymentRow } from "../api";
import {
  METHOD_OPTIONS,
  parse_method,
  parse_status,
  STATUS_OPTIONS,
  via_group,
} from "../filter/constants";
import Page from "../route";

afterEach(async () => {
  await cleanup();
  await reset_viewport();
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

const DESKTOP = [1440, 900] as const;
const PHONE = [375, 800] as const;

/** a loader that applies the url's filters to `items`, as the real one does */
async function render_page(
  entry: string,
  data: { items: PaymentRow[]; next?: string } = { items: [base] },
  size: readonly [number, number] = DESKTOP,
  delay_ms = 0
) {
  await page.viewport(size[0], size[1]);
  const seen: string[] = [];
  const Stub = createRoutesStub([
    {
      path: "/platform/donations",
      Component: Page,
      HydrateFallback: () => null,
      loader: async ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.search);
        if (delay_ms) await new Promise((r) => setTimeout(r, delay_ms));
        const statuses = parse_status(url.searchParams.get("status")).flatMap(
          (k) =>
            STATUS_OPTIONS.find((o) => o.value === k)!
              .statuses as readonly string[]
        );
        const methods = parse_method(url.searchParams.get("method"));
        const items = data.items.filter(
          (r) =>
            statuses.includes(r.status) &&
            (methods.length === 0 || methods.includes(via_group(r.via)))
        );
        return { items, next: data.next };
      },
    },
  ]);
  const screen = await render(<Stub initialEntries={[entry]} />);
  return { screen, seen };
}

type Screen = Awaited<ReturnType<typeof render_page>>["screen"];

const status_btn = (s: Screen, name: string | RegExp = /^Status filter/) =>
  s.getByRole("button", { name });
const method_btn = (s: Screen, name: string | RegExp = /^Method filter/) =>
  s.getByRole("button", { name });
const item = (s: Screen, name: string) =>
  s.getByRole("menuitemcheckbox", { name, exact: true });

const mixed_rows = [
  row("a", { status: "settled", via: "stripe:card" }),
  row("b", { status: "intent", via: "crypto:eth" }),
  row("c", { status: "failed", via: "paypal:paypal" }),
  row("d", { status: "failed", via: "crypto:bnb" }),
  row("e", { status: "refunded", via: "stripe:card" }),
];

describe("header filters at 1440", () => {
  it("shows the defaults without a Showing line or Clear filters", async () => {
    const { screen } = await render_page("/platform/donations");
    await expect
      .element(status_btn(screen, "Status filter: Settled"))
      .toBeVisible();
    await expect
      .element(method_btn(screen, "Method filter: All methods"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Showing:");
    expect(
      status_btn(screen).element().className.includes("text-primary")
    ).toBe(false);
  });

  it("orders the columns, with the funnels on Status and Method", async () => {
    const { screen } = await render_page("/platform/donations");
    await expect.element(status_btn(screen)).toBeVisible();
    const heads = [...document.querySelectorAll("thead th")].map((e) =>
      e.textContent?.trim()
    );
    expect(heads).toEqual([
      "Date",
      "Status",
      "Email",
      "NPO",
      "Amount",
      "Method",
      "Tip",
      "Fee cover",
      "Fee",
      "Match",
      "",
    ]);
  });

  it("draws the funnel no taller than the header text", async () => {
    const { screen } = await render_page("/platform/donations");
    const btn = status_btn(screen);
    await expect.element(btn).toBeVisible();
    const svg = btn.element().querySelector("svg")!;
    const th = btn.element().closest("th")!;
    const font = Number.parseFloat(getComputedStyle(th).fontSize);
    expect(svg.getBoundingClientRect().height).toBeLessThanOrEqual(font);
  });

  it("ticking two statuses shows both groups and writes a comma list", async () => {
    const { screen, seen } = await render_page("/platform/donations", {
      items: mixed_rows,
    });
    await status_btn(screen).click();
    await item(screen, "Awaiting funds").click();
    await vi.waitFor(() =>
      expect(seen.at(-1)).toBe("?status=settled%2Cawaiting")
    );
    // the list stays open for the next tick
    await item(screen, "Failed").click();
    await vi.waitFor(() =>
      expect(seen.at(-1)).toBe("?status=settled%2Cawaiting%2Cfailed")
    );
    await expect
      .element(
        screen.getByRole("cell", { name: "Awaiting crypto", exact: true })
      )
      .toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Failed", exact: true }).elements()
      ).toHaveLength(2)
    );
    expect(
      screen.getByRole("cell", { name: "Refunded", exact: true }).elements()
    ).toHaveLength(0);
  });

  it("unticking the last status snaps back to Settled", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?status=failed",
      { items: mixed_rows }
    );
    await status_btn(screen).click();
    await item(screen, "Failed").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    await expect
      .element(status_btn(screen, "Status filter: Settled"))
      .toBeVisible();
  });

  it("the Status top row is mixed, selects all, and returns to Settled", async () => {
    const { screen, seen } = await render_page("/platform/donations");
    await status_btn(screen).click();
    const top = item(screen, "All statuses");
    await expect.element(top).toHaveAttribute("aria-checked", "mixed");
    await top.click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?status=all"));
    await expect.element(top).toHaveAttribute("aria-checked", "true");
    await top.click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    await expect.element(top).toHaveAttribute("aria-checked", "mixed");
  });

  it("the Method top row is ticked only when nothing else is", async () => {
    const { screen, seen } = await render_page("/platform/donations");
    await method_btn(screen).click();
    const top = item(screen, "All methods");
    await expect.element(top).toHaveAttribute("aria-checked", "true");
    await item(screen, "Stripe").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=stripe"));
    await expect.element(top).toHaveAttribute("aria-checked", "false");
    await item(screen, "Crypto").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=stripe%2Ccrypto"));
    // the top row clears the others
    await top.click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    await expect.element(top).toHaveAttribute("aria-checked", "true");
    // unticking the last one returns to it
    await item(screen, "Stocks").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=stocks"));
    await item(screen, "Stocks").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    await expect.element(top).toHaveAttribute("aria-checked", "true");
  });

  it("a second tick before the list reloads builds on the first", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations",
      { items: mixed_rows },
      DESKTOP,
      400
    );
    await status_btn(screen).click();
    // both ticks land while the loader for the first is still pending
    await item(screen, "Awaiting funds").click();
    await item(screen, "Failed").click();
    await vi.waitFor(() =>
      expect(seen.at(-1)).toBe("?status=settled%2Cawaiting%2Cfailed")
    );
    await expect
      .element(status_btn(screen, "Status filter: 3 selected"))
      .toBeVisible();
  });

  it("a tick drops the cursor", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?cursor=abc"
    );
    await method_btn(screen).click();
    await item(screen, "DAF").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=daf"));
  });

  it("fills the funnel off its default and names the value", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=awaiting,failed&method=crypto"
    );
    const s = status_btn(screen, "Status filter: Awaiting funds, Failed");
    await expect.element(s).toBeVisible();
    expect(s.element().className).toContain("text-primary");
    const m = method_btn(screen, "Method filter: Crypto");
    expect(m.element().className).toContain("text-primary");
  });

  it("counts three or more", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=settled,awaiting,failed"
    );
    await expect
      .element(status_btn(screen, "Status filter: 3 selected"))
      .toBeVisible();
  });

  it("shows the Showing line off the defaults and collapses three", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=awaiting,failed&method=crypto"
    );
    await expect
      .element(screen.getByText("Awaiting funds, Failed"))
      .toBeVisible();
    expect(document.body.textContent).toContain("Showing:");
    expect(document.body.textContent).toContain("Crypto");
    await cleanup();

    const again = await render_page(
      "/platform/donations?status=settled,awaiting,failed&method=stripe,paypal,daf"
    );
    await expect.element(again.screen.getByText("3 statuses")).toBeVisible();
    await expect.element(again.screen.getByText("3 methods")).toBeVisible();
  });

  it("Showing reads All statuses and All methods", async () => {
    const { screen } = await render_page("/platform/donations?status=all");
    await expect
      .element(status_btn(screen, "Status filter: All statuses"))
      .toBeVisible();
    expect(document.body.textContent).toContain(
      "Showing: All statuses · All methods"
    );
  });

  it("an unknown value falls back and shows no Clear filters", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=x&method=y"
    );
    await expect
      .element(status_btn(screen, "Status filter: Settled"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .not.toBeInTheDocument();
  });

  it("Clear filters resets both and moves focus to the Status funnel", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?status=failed&method=crypto"
    );
    await screen.getByRole("button", { name: "Clear filters" }).click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""));
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .not.toBeInTheDocument();
    await expect
      .element(status_btn(screen, "Status filter: Settled"))
      .toHaveFocus();
  });

  it("an empty result keeps the filters usable", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=failed&method=match",
      { items: [] }
    );
    await expect
      .element(screen.getByText("No donations found"))
      .toBeInTheDocument();
    await expect.element(status_btn(screen)).toBeEnabled();
    await expect.element(method_btn(screen)).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .toBeVisible();
  });

  it("Space ticks, Escape closes, and focus returns to the funnel", async () => {
    const { screen, seen } = await render_page("/platform/donations");
    const trigger = method_btn(screen);
    trigger.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(item(screen, "All methods")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=stripe"));
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("menuitemcheckbox").first())
      .not.toBeInTheDocument();
    await expect
      .element(method_btn(screen, "Method filter: Stripe"))
      .toHaveFocus();
  });
});

describe("filters at 375", () => {
  it("swaps the header funnels for two chips", async () => {
    const { screen } = await render_page(
      "/platform/donations",
      { items: [base] },
      PHONE
    );
    const status = status_btn(screen, "Status filter: Settled");
    await expect.element(status).toBeVisible();
    expect(status.element().textContent).toContain("Status");
    expect(status.element().textContent).toContain("Settled");
    await expect
      .element(method_btn(screen, "Method filter: All methods"))
      .toBeVisible();
    // the header funnels are still in the table, hidden
    const funnels = [
      ...document.querySelectorAll<HTMLElement>("th [data-filter-trigger]"),
    ];
    expect(funnels).toHaveLength(2);
    for (const f of funnels) expect(f.offsetParent).toBeNull();
    // the chevron is the 14px icon step
    const chevron = status.element().querySelector("svg")!;
    expect(chevron.getBoundingClientRect().height).toBeLessThanOrEqual(14);
  });

  it("tints a chip off its default and shows a count for two", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=awaiting,failed&method=crypto",
      { items: mixed_rows },
      PHONE
    );
    const status = status_btn(screen, "Status filter: Awaiting funds, Failed");
    await expect.element(status).toBeVisible();
    expect(status.element().textContent).toMatch(/Status\s*2/);
    expect(status.element().className).toContain("border-ring");
    await expect
      .element(screen.getByRole("button", { name: "Clear filters" }))
      .toBeVisible();
  });

  it("a chip opens the same list", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations",
      { items: mixed_rows },
      PHONE
    );
    await method_btn(screen).click();
    await item(screen, "Crypto").click();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("?method=crypto"));
  });

  it("Clear filters moves focus to the Status chip", async () => {
    const { screen } = await render_page(
      "/platform/donations?method=crypto",
      { items: [base] },
      PHONE
    );
    await screen.getByRole("button", { name: "Clear filters" }).click();
    await expect
      .element(status_btn(screen, "Status filter: Settled"))
      .toHaveFocus();
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
    // the filters ride the link so closing the modal lands on the same list
    expect(els[0]!.getAttribute("href")).toContain("a/refund?status=all");
    expect(els[0]!.getAttribute("aria-label")).toBe(
      "Refund donation from a@test.com"
    );
    expect(screen.getByText("N/A").elements().length).toBe(3);
  });
});

describe("void match link", () => {
  it("carries the filters so closing the modal lands on the same list", async () => {
    const { screen } = await render_page(
      "/platform/donations?status=all&method=crypto",
      { items: [row("v", { via: "crypto:eth", match_event_id: "evt" })] }
    );
    const link = screen.getByRole("link", { name: /void/i });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toContain(
      "v/void-match?status=all&method=crypto"
    );
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
    await expect
      .element(screen.getByRole("cell", { name: label, exact: true }))
      .toBeVisible();
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

  it("Load more keeps both lists and adds the cursor", async () => {
    const { screen, seen } = await render_page(
      "/platform/donations?status=awaiting,failed&method=crypto,stripe",
      {
        items: [row("x", { status: "failed", via: "crypto:eth" })],
        next: "CUR",
      }
    );
    await screen.getByRole("button", { name: "View More" }).click();
    await vi.waitFor(() => {
      const last = new URLSearchParams(seen.at(-1));
      expect(last.get("status")).toBe("awaiting,failed");
      expect(last.get("method")).toBe("crypto,stripe");
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

describe("option tables", () => {
  it("lists every group in the menus", async () => {
    const { screen } = await render_page("/platform/donations");
    await status_btn(screen).click();
    for (const o of STATUS_OPTIONS) {
      await expect.element(item(screen, o.label)).toBeInTheDocument();
    }
    await userEvent.keyboard("{Escape}");
    await method_btn(screen).click();
    for (const o of METHOD_OPTIONS) {
      await expect.element(item(screen, o.label)).toBeInTheDocument();
    }
  });
});
