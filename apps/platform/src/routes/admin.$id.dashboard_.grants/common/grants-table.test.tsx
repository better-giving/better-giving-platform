import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { GrantsTable, type IGrantLine } from "./grants-table";

const grant = (id: string, amount: number, o: Partial<IGrantLine> = {}) =>
  ({
    id,
    other_id: null,
    npo_id: 42,
    date: "2026-11-09T15:00:00.000Z",
    amount,
    sources: null,
    status: "outgoing_payment_sent",
    hold_alerted_at: null,
    ...o,
  }) as IGrantLine;

const WHY =
  "Your bank sent this grant back, so it isn't counted in your grant totals. It goes out again once new bank details are approved.";

describe("grants table — a returned grant", () => {
  test("strikes the amount, marks it Returned and says why on open", async () => {
    const screen = await render(
      <GrantsTable
        items={[grant("g1", 1250, { status: "returned" }), grant("g2", 960.4)]}
      />
    );
    const amount = screen.getByText("$1,250.00", { exact: true });
    await expect.element(amount).toBeVisible();
    expect(getComputedStyle(amount.element()).textDecorationLine).toBe(
      "line-through"
    );
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    expect(screen.getByRole("tooltip").query()).toBeNull();
    await screen
      .getByRole("button", { name: "What this returned grant means" })
      .click();
    await expect
      .element(screen.getByRole("tooltip", { name: WHY }))
      .toBeVisible();
  });

  test("gives any other grant nothing extra", async () => {
    const screen = await render(<GrantsTable items={[grant("g2", 960.4)]} />);
    await expect.element(screen.getByText("$960.40")).toBeVisible();
    expect(screen.getByText("Returned").query()).toBeNull();
    expect(screen.getByRole("button").query()).toBeNull();
  });

  test("keeps a returned grant's gross and net beside its badge", async () => {
    const screen = await render(
      <GrantsTable
        items={[
          grant("g1", 1200, {
            status: "returned",
            run: {
              gross: 1250,
              net: 1200,
              deductions: [
                {
                  owed_id: "o1",
                  donation_id: "don-1",
                  gift_date: "2026-10-01T00:00:00.000Z",
                  gift_amount: 50,
                  gift_currency: "USD",
                  usd: 50,
                },
              ],
            },
          }),
        ]}
      />
    );
    const badge = screen.getByText("Returned", { exact: true }).element();
    const gross = screen.getByText("Gross $1,250.00").element();
    await expect.element(gross).toBeVisible();
    expect(
      badge.compareDocumentPosition(gross) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("grants table — sending and bounced grants", () => {
  // inside the poll window: older, a stored state is history and reads settled
  const sent = (id: string, amount: number, status: string, days_ago = 3) =>
    grant(id, amount, {
      other_id: `ref-${id}`,
      status,
      date: new Date(Date.now() - days_ago * 86_400_000).toISOString(),
    });
  const struck = (screen: Awaited<ReturnType<typeof render>>, text: string) =>
    getComputedStyle(screen.getByText(text, { exact: true }).element())
      .textDecorationLine;

  test("a grant funded but not yet reported sent shows Sending, an unstruck gray amount and Not counted yet", async () => {
    const screen = await render(
      <GrantsTable items={[sent("g1", 1120, "funds_converted")]} />
    );
    await expect
      .element(screen.getByText("Sending", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Not counted yet", { exact: true }))
      .toBeVisible();
    expect(struck(screen, "$1,120.00")).toBe("none");
    expect(
      screen.getByText("$1,120.00", { exact: true }).element().className
    ).toContain("text-gray-11");
    await screen
      .getByRole("button", { name: "What this sending grant means" })
      .click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "On its way to your bank, so not counted in your grant totals yet. It counts once it has been sent.",
        })
      )
      .toBeVisible();
  });

  test("a grant whose transfer was never read shows Sending too", async () => {
    const screen = await render(<GrantsTable items={[sent("g1", 50, "")]} />);
    await expect
      .element(screen.getByText("Sending", { exact: true }))
      .toBeVisible();
  });

  test.each(["bounced_back", "cancelled"])(
    "a grant whose transfer is %s shows a struck amount, Bounced and Not counted",
    async (status) => {
      const screen = await render(
        <GrantsTable items={[sent("g1", 481.5, status)]} />
      );
      await expect
        .element(screen.getByText("Bounced", { exact: true }))
        .toBeVisible();
      await expect
        .element(screen.getByText("Not counted", { exact: true }))
        .toBeVisible();
      expect(struck(screen, "$481.50")).toBe("line-through");
      await screen
        .getByRole("button", { name: "What this bounced grant means" })
        .click();
      await expect
        .element(
          screen.getByRole("tooltip", {
            name: "Your bank didn't accept this grant, so it isn't counted in your grant totals. The money is on its way back to your balance. Check your bank details.",
          })
        )
        .toBeVisible();
    }
  );

  test("an old run still on its way keeps reading Sending, and an old bounce Bounced", async () => {
    const screen = await render(
      <GrantsTable
        items={[
          sent("g1", 75, "funds_converted", 120),
          sent("g2", 481.5, "bounced_back", 120),
        ]}
      />
    );
    await expect
      .element(screen.getByText("Sending", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Bounced", { exact: true }))
      .toBeVisible();
  });

  test("a grant whose money is refunded reads Returned, not Sending", async () => {
    const screen = await render(
      <GrantsTable items={[sent("g1", 75, "funds_refunded")]} />
    );
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Sending").query()).toBeNull();
  });

  test("a late-delivered grant is a plain Settled-looking amount with nothing extra", async () => {
    const screen = await render(
      <GrantsTable items={[sent("g1", 481.5, "outgoing_payment_sent")]} />
    );
    await expect.element(screen.getByText("$481.50")).toBeVisible();
    expect(screen.getByText("Bounced").query()).toBeNull();
    expect(screen.getByText("Sending").query()).toBeNull();
    expect(screen.getByRole("button").query()).toBeNull();
    expect(struck(screen, "$481.50")).toBe("none");
  });
});
