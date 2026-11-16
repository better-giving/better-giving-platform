import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { SettlementRow } from "$/pg/queries/payout";
import { GrantsTable } from "./grants-table";

const grant = (id: string, status: string): SettlementRow =>
  ({
    id,
    other_id: `ref-${id}`,
    npo_id: 42,
    date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    amount: 481.5,
    sources: null,
    status,
    hold_alerted_at: null,
    recipient_id: null,
  }) as SettlementRow;

describe("dashboard payout history — grant rows", () => {
  test("a bounced grant is struck, Bounced and Not counted", async () => {
    const screen = await render(
      <GrantsTable items={[grant("g1", "bounced_back")]} />
    );
    await expect
      .element(screen.getByText("Bounced", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Not counted", { exact: true }))
      .toBeVisible();
    expect(
      getComputedStyle(screen.getByText("$481.50").element()).textDecorationLine
    ).toBe("line-through");
  });

  test("a sending grant says Not counted yet, and a delivered one has nothing extra", async () => {
    const sending = await render(
      <GrantsTable items={[grant("g1", "processing")]} />
    );
    await expect
      .element(sending.getByText("Not counted yet", { exact: true }))
      .toBeVisible();
    await sending.unmount();
    const delivered = await render(
      <GrantsTable items={[grant("g2", "outgoing_payment_sent")]} />
    );
    await expect.element(delivered.getByText("$481.50")).toBeVisible();
    expect(delivered.getByText("Not counted").query()).toBeNull();
  });
});
