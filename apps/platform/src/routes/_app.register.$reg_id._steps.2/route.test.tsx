import { createRoutesStub, data, Outlet, redirect } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";

// the page's own server modules: the stub supplies its loader and action
vi.mock("#/pages/registration/data/step-loader", () => ({
  step_loader: () => () => null,
}));
vi.mock("#/pages/registration/update-action", () => ({
  update_action: () => vi.fn(),
}));

import Page from "./route";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SLUG_30 = "harbor-light-food-bank-of-ohio";

/** step 2 answered, slug aside */
const REG = {
  id: RID,
  r_id: "jane@test.com",
  status: "01",
  o_type: "501c3",
  o_ein: "123456789",
  r_first_name: "Jane",
  r_last_name: "Doe",
  o_name: "Harbor Light Food Bank",
  r_org_role: "ceo",
  rm: "search-engines",
  o_website: "https://harborlight.org",
  o_hq_country: "United States",
  o_designation: "Charity",
  o_active_in_countries: [],
};

const render_step = async (
  action: (args: { request: Request }) => unknown,
  reg: Record<string, unknown> = {}
) => {
  const Stub = createRoutesStub([
    {
      id: "routes/_app.register.$reg_id",
      path: "/register/:reg_id",
      Component: Outlet,
      loader: () => ({ connect_routing: true }),
      children: [
        {
          path: "2",
          Component: Page as any,
          loader: () => ({ ...REG, ...reg }),
          action,
        },
        { path: "3", Component: () => <p>step three</p> },
      ],
    },
  ]);
  const screen = await render(<Stub initialEntries={[`/register/${RID}/2`]} />);
  const slug = screen.getByLabelText("Organization slug");
  await expect.element(slug).toBeVisible();
  return { screen, slug };
};

const continue_ = (screen: Awaited<ReturnType<typeof render_step>>["screen"]) =>
  screen.getByRole("button", { name: "Continue", exact: true }).click();

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

describe("step 2 organization slug", () => {
  test("an optional field after countries, previewing the page's address as it's typed", async () => {
    const { screen, slug } = await render_step(vi.fn());

    await expect
      .element(slug)
      .toHaveAttribute("placeholder", "harbor-light-food-bank");
    await expect.element(slug).toHaveValue("");
    await expect.element(slug).not.toHaveAttribute("aria-required");
    const label = screen.getByText("Organization slug", { exact: true });
    expect(label.element().textContent).not.toMatch(/\*|optional/);
    expect(screen.getByText("Donors will find").query()).toBeNull();

    await slug.fill(" harbor-light ");

    await expect
      .element(screen.getByText("Donors will find your Better Giving page at"))
      .toMatchTextContent(/\/org\/harbor-light$/);
  });

  test("every label sits 8px above its control", async () => {
    const { screen } = await render_step(vi.fn());

    for (const text of [
      "Website of your organization",
      "Nonprofit Designation",
      "Select the countries your organization is active in",
      "Organization slug",
    ]) {
      const label = screen.getByText(text).element().closest(".label")!;
      expect(getComputedStyle(label).marginBottom, text).toBe("8px");
    }
  });

  test("continues with an empty slug, sending none", async () => {
    const action = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).not.toHaveProperty("o_slug");
      return redirect(`/register/${RID}/3`);
    });
    const { screen } = await render_step(action, { o_website: undefined });

    await screen
      .getByLabelText("Website of your organization")
      .fill("harborlight.org");
    await continue_(screen);

    await expect.element(screen.getByText("step three")).toBeVisible();
    expect(action).toHaveBeenCalledOnce();
  });

  test("sends a typed slug trimmed", async () => {
    const action = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toMatchObject({
        update_type: "org",
        o_slug: "harbor-light",
      });
      return null;
    });
    const { screen, slug } = await render_step(action);

    await slug.fill("  harbor-light ");
    await continue_(screen);

    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  });

  test.each([
    [SLUG_30.concat("x"), "Use 30 characters or fewer"],
    ["1234", "Don't use only numbers"],
    ["harbor light", "Use only English letters (a-z), numbers, and - . _ ~"],
    ["harbor..light", "Don't use two dots in a row"],
    [".harbor", "Don't start or end with a dot"],
    ["admin", "Pick a different slug: admin is reserved"],
  ])("refuses %s on Continue, saying why", async (value, message) => {
    const action = vi.fn();
    const { screen, slug } = await render_step(action);

    await slug.fill(value);
    await continue_(screen);

    await expect
      .element(screen.getByText(message, { exact: true }))
      .toBeVisible();
    await expect.element(slug).toHaveAttribute("aria-invalid", "true");
    await expect.element(slug).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  test("a taken slug shows in the field, focused, and clears as it's retyped", async () => {
    const action = vi.fn(() =>
      data(
        { field_errors: { o_slug: 'Slug "harbor-light" is already taken' } },
        { status: 400 }
      )
    );
    const { screen, slug } = await render_step(action);

    await slug.fill("harbor-light");
    await continue_(screen);

    await expect
      .element(screen.getByText('Slug "harbor-light" is already taken'))
      .toBeVisible();
    await expect.element(slug).toHaveFocus();
    await expect.element(slug).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(slug, "-ohio");

    await expect
      .element(screen.getByText("is already taken"))
      .not.toBeInTheDocument();
  });

  test("a 30-character slug's address wraps inside the field's width at 375", async () => {
    await page.viewport(375, 896);
    const { screen, slug } = await render_step(vi.fn());

    await slug.fill(SLUG_30);

    const sub = screen.getByText("Donors will find your Better Giving page at");
    await expect.element(sub).toMatchTextContent(SLUG_30);
    const field = slug.element().closest(".min-w-0") as HTMLElement;
    expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
