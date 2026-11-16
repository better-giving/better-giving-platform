import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import Prompt from "./prompt";

const render_prompt = (
  verdict: string,
  review: { o_bank_id?: string; own_account: boolean | "unknown" }
) => {
  const Stub = createRoutesStub([
    {
      id: "routes/platform.applications_.$id",
      path: "/platform/applications/:id",
      loader: () => ({
        reg: { o_name: "Acme Relief", o_bank_id: review.o_bank_id ?? "" },
        own_account: review.own_account,
      }),
      Component: Outlet,
      HydrateFallback: () => null,
      children: [{ path: ":verdict", Component: Prompt }],
    },
  ]);
  return render(
    <Stub initialEntries={[`/platform/applications/r1/${verdict}`]} />
  );
};

const MATCH = "This bank account matches one of Better Giving's own accounts";
const UNKNOWN =
  "We couldn't check this bank account against Better Giving's own accounts";

describe("registration approve prompt: own-account warning", () => {
  test("reads 'about to approve', not 'about to approved'", async () => {
    const screen = await render_prompt("approved", { own_account: false });

    await expect
      .element(
        screen.getByText(/You are about to approve the\s+Application for/)
      )
      .toBeVisible();
    expect(screen.getByText(/about to approved/).query()).toBeNull();
  });

  test("a rejection reads 'about to reject'", async () => {
    const screen = await render_prompt("rejected", {
      own_account: true,
      o_bank_id: "1",
    });

    await expect
      .element(
        screen.getByText(/You are about to reject the\s+Application for/)
      )
      .toBeVisible();
  });

  test("a bank that matches one of ours is warned about, between the payout sentence and the confirm line", async () => {
    const screen = await render_prompt("approved", {
      o_bank_id: "40000001",
      own_account: true,
    });

    await expect
      .element(screen.getByRole("region", { name: MATCH }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Payouts to it may not reach the nonprofit. You can still approve."
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Submit" }))
      .toBeEnabled();
  });

  test("a check that could not run is said to staff", async () => {
    const screen = await render_prompt("approved", {
      o_bank_id: "40000001",
      own_account: "unknown",
    });

    await expect
      .element(screen.getByRole("region", { name: UNKNOWN }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText("It may be one of ours. You can still approve.")
      )
      .toBeVisible();
  });

  test.each([
    ["no match", { o_bank_id: "40000001", own_account: false }],
    ["no bank on file (Stripe only)", { own_account: true }],
  ])("shows no warning for %s", async (_name, review) => {
    const screen = await render_prompt("approved", review);

    await expect
      .element(
        screen.getByText("Please ensure you have confirmed", { exact: false })
      )
      .toBeVisible();
    expect(screen.getByRole("region").query()).toBeNull();
  });

  test("a rejection carries no warning", async () => {
    const screen = await render_prompt("rejected", {
      o_bank_id: "40000001",
      own_account: true,
    });

    await expect
      .element(screen.getByText("Reason for rejection:"))
      .toBeVisible();
    expect(screen.getByRole("region").query()).toBeNull();
  });
});
