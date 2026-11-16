import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { IPayout, PayoutStatus } from "@/payouts";
import { PayoutsTable } from "./payouts-table";

const payout = (id: string, status: PayoutStatus, amount: number): IPayout =>
  ({
    id,
    source_id: `don-${id}`,
    npo_id: 42,
    source: "donation",
    date: "2026-11-09T15:00:00.000Z",
    amount,
    ...status,
  }) as IPayout;

const ITEMS: IPayout[] = [
  payout("a", { type: "returned" }, 250),
  payout("b", { type: "void" }, 480),
  payout("c", { type: "processing", ref: "" }, 75),
  payout("d", { type: "refunded" }, 320),
];

const render_table = (items: IPayout[]) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <PayoutsTable items={items} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("payouts table — returned and void", () => {
  // an open tooltip is portaled out of the render and would cover the next test's button
  afterEach(async () => {
    await userEvent.keyboard("{Escape}");
  });

  test("a returned and a void payout each get a (!) button, and no other row does", async () => {
    const screen = await render_table(ITEMS);
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    // four payouts, no explanation rows
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(4);
    await expect
      .element(screen.getByRole("button", { name: "What Returned means" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "What Void means" }))
      .toBeVisible();
    // the processing one is Sending, which explains itself too
    await expect
      .element(screen.getByRole("button", { name: "What Sending means" }))
      .toBeVisible();
    expect(screen.getByRole("button").elements()).toHaveLength(3);
  });

  test("opening the returned button shows what it means", async () => {
    const screen = await render_table(ITEMS);
    await screen.getByRole("button", { name: "What Returned means" }).click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "Your bank sent this back, and the money is in your balance. Update your bank details; it goes out again once the new ones are approved.",
        })
      )
      .toBeVisible();
  });

  test("opening the void button shows what it means", async () => {
    const screen = await render_table(ITEMS);
    await screen.getByRole("button", { name: "What Void means" }).click();
    await expect
      .element(screen.getByRole("tooltip", { name: "Not counted as a grant." }))
      .toBeVisible();
  });

  test("strikes a void amount, not a returned one", async () => {
    const screen = await render_table(ITEMS);
    const struck = (text: string) =>
      getComputedStyle(screen.getByText(text, { exact: true }).element())
        .textDecorationLine;
    await expect.element(screen.getByText("$480.00")).toBeVisible();
    expect(struck("$480.00")).toBe("line-through");
    expect(struck("$250.00")).toBe("none");
    // refunded keeps its own strike
    expect(struck("$320.00")).toBe("line-through");
  });

  test("a table with only settled and refunded payouts has no (!) button", async () => {
    const screen = await render_table([
      payout("s", { type: "settled", settled_date: "", settled_id: "t" }, 75),
      ITEMS[3]!,
    ]);
    await expect.element(screen.getByText("Settled")).toBeVisible();
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByRole("button").query()).toBeNull();
  });
});

describe("payouts table — sending and bounced", () => {
  afterEach(async () => {
    await userEvent.keyboard("{Escape}");
  });

  const rows = [
    payout("s", { type: "processing", ref: "r" }, 1120),
    payout("b", { type: "bounced" }, 481.5),
    payout("d", { type: "settled", settled_date: "", settled_id: "t" }, 960.4),
  ];
  const arrow_of = (
    screen: Awaited<ReturnType<typeof render_table>>,
    i: number
  ) => screen.container.querySelectorAll("tbody tr")[i]!.querySelector("svg")!;

  test("a processing payout reads Sending, and its (!) says the bank hasn't confirmed", async () => {
    const screen = await render_table(rows);
    await expect
      .element(screen.getByText("Sending", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Processing").query()).toBeNull();
    await screen.getByRole("button", { name: "What Sending means" }).click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "This payout is on its way to your bank. It counts as Settled once it has been sent. Nothing is needed from you.",
        })
      )
      .toBeVisible();
  });

  test("a bounced payout reads Bounced with its (!), a muted arrow and an unstruck amount", async () => {
    const screen = await render_table(rows);
    await expect
      .element(screen.getByText("Bounced", { exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "What Bounced means" }).click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "Your bank didn't accept this payout, and the money is on its way back to your balance. Check that your bank details are right and update them if not. It goes out again once the new ones are approved.",
        })
      )
      .toBeVisible();
    expect(
      getComputedStyle(screen.getByText("$481.50", { exact: true }).element())
        .textDecorationLine
    ).toBe("none");
    expect(arrow_of(screen, 1).classList.contains("stroke-gray-11")).toBe(true);
    expect(arrow_of(screen, 0).classList.contains("stroke-gray-11")).toBe(true);
  });

  test("a settled payout, late-delivered or not, has the green arrow and no (!)", async () => {
    const screen = await render_table(rows);
    expect(arrow_of(screen, 2).classList.contains("stroke-success")).toBe(true);
    expect(screen.getByRole("button").elements()).toHaveLength(2);
  });
});

describe("payouts table — reversed payout", () => {
  afterEach(async () => {
    await userEvent.keyboard("{Escape}");
  });

  test("a bounced payout whose transfer was charged back explains it was reversed, and a plain bounce keeps its own tip", async () => {
    const screen = await render_table([
      payout("c", { type: "bounced", charged_back: true }, 481.5),
      payout("b", { type: "bounced" }, 90),
    ]);
    await screen
      .getByRole("button", { name: "What this reversed payout means" })
      .click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "This payout was reversed after it was sent, and it hasn't come back to your balance. We're sorting it out by hand, so you don't need to chase it.",
        })
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "What Bounced means" }))
      .toBeVisible();
    // label, dot and amount are the same as a bounce: unstruck
    expect(
      screen.getByText("Bounced", { exact: true }).elements()
    ).toHaveLength(2);
  });
});
