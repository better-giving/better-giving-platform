import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { StripeConnectStatus, type TConnectStatus } from "./status";

const labels: [TConnectStatus, string][] = [
  ["not_connected", "Not connected"],
  ["incomplete", "Finish setup on Stripe"],
  ["pending", "Pending review"],
  ["ready", "Ready to receive Stripe donations"],
  ["disconnected", "Disconnected. Stripe donations go to your bank payout."],
];

describe("StripeConnectStatus", () => {
  test.each(labels)("%s reads %s", async (status, label) => {
    const screen = await render(<StripeConnectStatus status={status} />);
    await expect
      .element(screen.getByText(label, { exact: true }))
      .toBeVisible();

    const dashboard = screen.getByRole("link", { name: /stripe dashboard/i });
    if (status === "not_connected" || status === "disconnected") {
      // no account of ours to look at on Stripe: none yet, or access revoked
      await expect.element(dashboard).not.toBeInTheDocument();
      return;
    }
    await expect
      .element(dashboard)
      .toHaveAttribute("href", "https://dashboard.stripe.com/");
    await expect.element(dashboard).toHaveAttribute("target", "_blank");
  });
});
