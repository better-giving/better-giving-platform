import {
  type ActionFunctionArgs,
  createRoutesStub,
  Outlet,
} from "react-router";
import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Prompt } from "./prompt";

/** an action held open until the test lets every call so far answer */
const held_action = () => {
  const held: (() => void)[] = [];
  const action = vi.fn(async (_: ActionFunctionArgs) => {
    await new Promise<void>((r) => held.push(r));
    return null;
  });
  const release = () => {
    for (const r of held.splice(0)) r();
  };
  return { action, release };
};

const stub = (action: (args: ActionFunctionArgs) => Promise<null>) =>
  createRoutesStub([
    {
      path: "/applications/:id",
      Component: () => (
        <>
          <p>application detail</p>
          <Outlet />
        </>
      ),
      children: [
        {
          path: "approve",
          Component: () => <Prompt verdict="approved" />,
          action,
        },
      ],
    },
  ]);

// native clicks: the dialog backdrop fails playwright's actionability check
const press = (el: Element) => (el as HTMLElement).click();

describe("banking application verdict prompt", () => {
  test.each(["Close", "Cancel"])(
    "Enter on %s while the verdict is in flight leaves the dialog open, and leaves once it lands",
    async (name) => {
      const { action, release } = held_action();
      const Stub = stub(action);
      const screen = await render(
        <Stub initialEntries={["/applications/app-1/approve"]} />
      );
      const dialog = screen.getByRole("dialog", {
        name: "Banking application",
        exact: true,
      });
      await expect.element(dialog).toBeVisible();

      const submit = screen.getByRole("button", { name: "Submit" });
      (submit.element() as HTMLElement).focus();
      press(submit.element());
      await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
      // held, not disabled: focus stays on Submit rather than dropping
      await expect.element(submit).toHaveAttribute("aria-disabled", "true");
      await expect.element(submit).toHaveFocus();

      const link = screen.getByRole("link", { name, exact: true });
      await expect.element(link).toHaveAttribute("aria-disabled", "true");
      (link.element() as HTMLElement).focus();
      await userEvent.keyboard("{Enter}");
      await new Promise((r) => requestAnimationFrame(r));
      await expect.element(dialog).toBeInTheDocument();

      release();
      await expect.element(link).not.toHaveAttribute("aria-disabled", "true");
      (link.element() as HTMLElement).focus();
      await userEvent.keyboard("{Enter}");
      await expect.element(dialog).not.toBeInTheDocument();
      await expect
        .element(screen.getByText("application detail"))
        .toBeVisible();
    }
  );
});
