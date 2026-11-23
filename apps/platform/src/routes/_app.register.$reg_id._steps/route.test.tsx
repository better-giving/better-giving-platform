import { createRoutesStub, Outlet } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";

// the outer layout's server loader: the stub supplies its own
vi.mock("../_app.register/api", () => ({ loader: vi.fn() }));

import Register from "../_app.register/route";
import Steps from "./route";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const render_wizard = () => {
  const Stub = createRoutesStub([
    {
      path: "/register",
      Component: Register as any,
      loader: () => ({ id: "u1", email: "jane@test.com" }),
      children: [
        {
          id: "routes/_app.register.$reg_id",
          path: ":reg_id",
          Component: Outlet,
          loader: () => ({
            reg: { id: RID, status: "01", o_type: "501c3", o_ein: "123456789" },
            user: { id: "u1", email: "jane@test.com" },
            connect_routing: true,
          }),
          children: [
            {
              Component: Steps as any,
              children: [{ path: "2", Component: () => <p>step two</p> }],
            },
          ],
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={[`/register/${RID}/2`]} />);
};

describe("registration wizard card at 375", () => {
  afterEach(() => reset_viewport());

  test("sits 20px from each edge, with 16px above and below the step strip", async () => {
    await page.viewport(375, 896);
    const screen = await render_wizard();
    await expect.element(screen.getByText("step two")).toBeVisible();

    const card = document.querySelector<HTMLElement>(".rounded-card")!;
    const rect = card.getBoundingClientRect();
    expect(rect.left).toBe(20);
    expect(375 - rect.right).toBe(20);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);

    // the strip is the card's first child and starts at the card's own edge
    const strip = card.firstElementChild as HTMLElement;
    expect(getComputedStyle(card).paddingTop).toBe("0px");
    expect(getComputedStyle(strip).paddingTop).toBe("16px");
    expect(getComputedStyle(strip).paddingBottom).toBe("16px");
  });

  test("keeps the desktop card's 32px top padding", async () => {
    await page.viewport(1440, 900);
    const screen = await render_wizard();
    await expect.element(screen.getByText("step two")).toBeVisible();

    const card = document.querySelector<HTMLElement>(".rounded-card")!;
    expect(getComputedStyle(card).paddingTop).toBe("32px");
    expect(card.getBoundingClientRect().left).toBeGreaterThan(20);
  });
});
