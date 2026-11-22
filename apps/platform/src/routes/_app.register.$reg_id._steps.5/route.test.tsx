import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
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

const stub = (action: () => unknown, reg: Record<string, unknown> = {}) =>
  createRoutesStub([
    {
      path: "/register/:reg_id/5",
      Component: Page as any,
      loader: () => ({ id: RID, status: "01", o_type: "501c3", ...reg }),
      action,
      ErrorBoundary: () => <p>error boundary</p>,
    },
  ]);

/** the summary's content width inside the wizard card at a 375 viewport:
 * 20px gutters, the card's 1px edges and its 24px inset each side */
const SUMMARY_AT_375 = 285;
const SLUG_30 = "harbor-light-food-bank-of-ohio";

/** right edge of the widest line `el`'s text renders on */
const widest_line_right = (el: Element) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  return Math.max(...Array.from(range.getClientRects(), (r) => r.right));
};

describe("step 5 organization row", () => {
  afterEach(() => reset_viewport());

  test("shows no address while the application has no slug", async () => {
    const Stub = stub(vi.fn());
    const screen = await render(
      <Stub initialEntries={[`/register/${RID}/5`]} />
    );

    await expect
      .element(screen.getByText("Organization", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("better.giving/").query()).toBeNull();
  });

  test("a 30-character slug wraps clear of Update at 375", async () => {
    await page.viewport(375, 896);
    const Stub = stub(vi.fn(), { o_slug: SLUG_30 });
    const screen = await render(
      <div style={{ width: SUMMARY_AT_375 }}>
        <Stub initialEntries={[`/register/${RID}/5`]} />
      </div>
    );

    const address = screen.getByText(`better.giving/org/${SLUG_30}`);
    await expect.element(address).toBeVisible();
    const el = address.element();
    const row = el.parentElement!.parentElement!;
    const update = row.querySelector("a")!.getBoundingClientRect();

    expect(update.left - widest_line_right(el)).toBeGreaterThanOrEqual(24);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  });
});

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
