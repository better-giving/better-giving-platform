import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { resp } from "@/helpers/https";

// the page's own server modules: the stub supplies its loader and action
vi.mock("./submit-action", () => ({ submit_action: vi.fn() }));
vi.mock("#/pages/registration/data/step-loader", () => ({
  step_loader: () => () => null,
}));

import Page from "./route";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLAIMED =
  "This Stripe account is now connected elsewhere on Better Giving. Connect a different account or add a bank account, then submit again.";

const stub = (action: () => unknown) =>
  createRoutesStub([
    {
      path: "/register/:reg_id/5",
      Component: Page as any,
      loader: () => ({ id: RID, status: "01", o_type: "501c3" }),
      action,
      ErrorBoundary: () => <p>error boundary</p>,
    },
  ]);

describe("step 5 summary", () => {
  test("a refused submit keeps the summary up and says why beside Continue", async () => {
    const Stub = stub(() => resp.fail(409, CLAIMED));
    const screen = await render(
      <Stub initialEntries={[`/register/${RID}/5`]} />
    );

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(CLAIMED);
    await expect
      .element(screen.getByText("Summary", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("error boundary").query()).toBeNull();
    // the press is the applicant's to make again once they've fixed banking
    await expect
      .element(screen.getByRole("button", { name: "Continue", exact: true }))
      .toBeEnabled();
  });
});
