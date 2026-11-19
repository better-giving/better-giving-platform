import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import Prompt from "./prompt";

const render_prompt = (
  verdict: string,
  review: { o_bank_id?: string } = {}
) => {
  const Stub = createRoutesStub([
    {
      id: "routes/platform.applications_.$id",
      path: "/platform/applications/:id",
      loader: () => ({
        reg: { o_name: "Acme Relief", o_bank_id: review.o_bank_id ?? "" },
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

describe("registration approve prompt", () => {
  test("reads 'about to approve', not 'about to approved'", async () => {
    const screen = await render_prompt("approved");

    await expect
      .element(
        screen.getByText(/You are about to approve the\s+Application for/)
      )
      .toBeVisible();
    expect(screen.getByText(/about to approved/).query()).toBeNull();
  });

  test("a rejection reads 'about to reject'", async () => {
    const screen = await render_prompt("rejected", { o_bank_id: "1" });

    await expect
      .element(
        screen.getByText(/You are about to reject the\s+Application for/)
      )
      .toBeVisible();
  });

  test("the status badge calls the starting status Under review", async () => {
    const screen = await render_prompt("approved");

    await expect
      .element(screen.getByText("Under review", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Pending", { exact: true }).query()).toBeNull();
  });

  test("a rejection asks for a reason", async () => {
    const screen = await render_prompt("rejected", { o_bank_id: "40000001" });

    await expect
      .element(screen.getByText("Reason for rejection:"))
      .toBeVisible();
  });
});
