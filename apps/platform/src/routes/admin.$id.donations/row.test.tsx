import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { IRow } from "./helpers";
import { Row } from "./row";

// $15 at 1.5% base + 3% processing: the fees print $0.23 and $0.45, and the
// net is 14.325 before any rounding
const fees = {
  base: 0.225,
  fsa: 0,
  processing: 0.45,
  processing_allowance: 0,
};
const refunded = {
  id: "qa-05",
  date: "2026-08-01T00:00:00.000Z",
  currency: "USD",
  amount: 15,
  amount_usd: 15,
  net_usd: 14.325,
  fees,
  fee_base: fees.base,
  fee_fsa: fees.fsa,
  fee_processing: fees.processing,
  fee_covered_by_donor: false,
  payment_method: "Card",
  frequency: "one-time",
  program_name: "",
  donation_origin: "bg-marketplace",
  donation_origin_id: "",
  donation_origin_tag: "",
  donor_name: "Jane Doe",
  donor_email: "jane@example.com",
  donor_company: "",
  street: "",
  city: "",
  state: "",
  zip_code: "",
  country: "",
  program_id: "",
  recipient_id: 1,
  allocation: { cash: 100, liq: 0, lock: 0 },
  status: "refunded",
} satisfies IRow;

async function mount(row: IRow) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <table>
          <tbody>
            <tr>
              <Row {...row} />
            </tr>
          </tbody>
        </table>
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("a refunded donation row", () => {
  test("nets the same figure the allocation shows", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <table>
            <tbody>
              <tr>
                <Row {...refunded} />
              </tr>
            </tbody>
          </table>
        ),
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);

    const cells = screen.getByRole("cell");
    await expect.element(cells.first()).toBeVisible();
    const [net, allocation] = cells.elements().slice(6, 8);
    expect(net.firstElementChild?.textContent).toBe("$14.32");
    expect(allocation.textContent).toMatch(/^\$14\.32- Grant$/);
  });
});

describe("a reversed donation's net", () => {
  async function render_row(row: IRow) {
    const screen = await mount(row);
    const net = screen.getByRole("cell").nth(6);
    await expect.element(net).toBeVisible();
    const figure = net.element().firstElementChild as HTMLElement;
    return {
      struck: getComputedStyle(figure).textDecorationLine === "line-through",
      // the reversal tooltip's trigger
      flagged: net.element().querySelector("svg") !== null,
    };
  }

  async function tip_of(row: IRow) {
    const screen = await mount(row);
    // scoped to the net cell: a stripe_payout adds its own "More info"
    const trigger = screen
      .getByRole("cell")
      .nth(6)
      .getByRole("button", { name: "More info", exact: true });
    await expect.element(trigger).toBeVisible();
    return trigger;
  }

  test.each([
    ["refunded", true],
    ["refunded", false],
    ["refunded_loss", true],
    ["refunded_loss", false],
  ] as const)(
    "a %s row (cancelled: %s) strikes its net and flags it",
    async (status, cancelled) => {
      expect(await render_row({ ...refunded, status, cancelled })).toEqual({
        struck: true,
        flagged: true,
      });
    }
  );

  test("a cancelled duplicate says Cancelled, not Refunded", async () => {
    const tip = await tip_of({ ...refunded, cancelled: true });
    await expect.element(tip).toHaveAccessibleDescription(/^Cancelled/);
    await expect.element(tip).toHaveAccessibleDescription(/No refund was made/);
    await expect.element(tip).not.toHaveAccessibleDescription(/Refunded/);
  });

  test.each([
    ["refunded", false],
    ["refunded_loss", false],
    // a loss is money that went back, whatever the donation's status
    ["refunded_loss", true],
  ] as const)(
    "a %s row (cancelled: %s) says Refunded",
    async (status, cancelled) => {
      const tip = await tip_of({ ...refunded, status, cancelled });
      await expect.element(tip).toHaveAccessibleDescription("Refunded");
    }
  );

  test("a settled row does neither", async () => {
    expect(await render_row({ ...refunded, status: "settled" })).toEqual({
      struck: false,
      flagged: false,
    });
  });
});

describe("where a donation's net went", () => {
  async function render_row(row: IRow) {
    const screen = await mount(row);
    const cells = screen.getByRole("cell");
    await expect.element(cells.first()).toBeVisible();
    const [net, allocation] = cells.elements().slice(6, 8);
    return {
      flow: allocation.textContent,
      struck:
        getComputedStyle(net.firstElementChild as HTMLElement)
          .textDecorationLine === "line-through",
    };
  }
  const settled = { ...refunded, status: "settled" } satisfies IRow;

  test("a transferred stripe-routed donation says it was paid out to stripe", async () => {
    const { flow } = await render_row({
      ...settled,
      stripe_payout: "paid",
    });
    expect(flow).toBe("$14.32- Paid out");
  });

  test("a stripe-routed donation with no transfer yet says it is sending", async () => {
    const { flow } = await render_row({ ...settled, stripe_payout: "sending" });
    expect(flow).toBe("$14.32- Sending to Stripe");
  });

  test("a pooled donation keeps its grant, savings and investments split", async () => {
    const { flow } = await render_row({
      ...settled,
      net_usd: 100,
      allocation: { cash: 50, liq: 30, lock: 20 },
    });
    expect(flow).toBe("$50.00- Grant$30.00- Savings$20.00- Investments");
  });

  test("a refunded stripe-routed donation still strikes its net", async () => {
    expect(await render_row({ ...refunded, stripe_payout: "paid" })).toEqual({
      flow: "$14.32- Paid out",
      struck: true,
    });
  });

  test("a transferred stripe-routed donation that was refunded says it was fully reversed, as the payouts page does", async () => {
    expect(
      await render_row({ ...refunded, stripe_payout: "reversed" })
    ).toEqual({ flow: "$14.32- Fully reversed", struck: true });
  });

  test("a refunded donation whose transfer is kept says it is owed to Better Giving", async () => {
    expect(await render_row({ ...refunded, stripe_payout: "kept" })).toEqual({
      flow: "$14.32- Refunded, owed to Better Giving",
      struck: true,
    });
  });

  test("a stripe-routed donation refunded before its transfer says it was not sent", async () => {
    expect(
      await render_row({ ...refunded, stripe_payout: "not_sent" })
    ).toEqual({ flow: "$14.32- Not sent to Stripe", struck: true });
  });
});
