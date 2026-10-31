import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { AppHeader } from "./app-header";

const session_mock = vi.hoisted(() => ({
  value: undefined as { signed_in: boolean } | undefined,
}));

vi.mock("#/hooks/use-session", () => ({
  use_session: () => ({
    session: session_mock.value,
    is_loading: false,
    revalidate: vi.fn(),
  }),
}));

afterEach(async () => {
  await cleanup();
  session_mock.value = undefined;
});

function stub(logout_action = vi.fn((_: { request: Request }) => null)) {
  return createRoutesStub([
    {
      path: "/marketplace",
      Component: () => <AppHeader />,
    },
    { path: "/dashboard", Component: () => <h1>Dashboard page</h1> },
    { path: "/logout", action: logout_action, Component: () => null },
  ]);
}

describe("app header account control", () => {
  test("signed in: the account menu offers Dashboard and Log out, and Log out posts to /logout", async () => {
    session_mock.value = { signed_in: true };
    const logout_action = vi.fn((_: { request: Request }) => null);
    const Stub = stub(logout_action);
    const screen = await render(<Stub initialEntries={["/marketplace"]} />);

    const banner = screen.getByRole("banner");
    const trigger = banner.getByRole("button", { name: "Account menu" });
    await expect.element(trigger).toBeVisible();
    expect(banner.getByRole("link", { name: "Log In" }).query()).toBeNull();

    await trigger.click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Dashboard" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: "Log out" }))
      .toBeVisible();

    await screen.getByRole("menuitem", { name: "Log out" }).click();
    await vi.waitFor(() => expect(logout_action).toHaveBeenCalledOnce());
    const [{ request }] = logout_action.mock.calls[0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/logout");
  });

  test("keyboard: Enter opens, arrows move, Esc closes, Enter on Dashboard navigates", async () => {
    session_mock.value = { signed_in: true };
    const Stub = stub();
    const screen = await render(<Stub initialEntries={["/marketplace"]} />);

    const trigger = screen.getByRole("button", { name: "Account menu" });
    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    await expect.element(menu).toBeVisible();

    await userEvent.keyboard("{Escape}");
    // no stylesheet here, so the exit animation never hides it: read the state
    await expect.element(menu).toHaveAttribute("data-state", "closed");
    await expect.element(trigger).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect.element(menu).toBeVisible();
    // first item highlights on open; ArrowDown then back up lands on Dashboard
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Log out" }))
      .toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Dashboard" }))
      .toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("heading", { name: "Dashboard page" }))
      .toBeVisible();
  });

  test("signed out: Log In and sign-up links, no account menu", async () => {
    const Stub = stub();
    const screen = await render(<Stub initialEntries={["/marketplace"]} />);

    const banner = screen.getByRole("banner");
    await expect
      .element(banner.getByRole("link", { name: "Log In" }))
      .toBeVisible();
    await expect
      .element(banner.getByRole("link", { name: "Join Us Today!" }))
      .toBeVisible();
    expect(
      banner.getByRole("button", { name: "Account menu" }).query()
    ).toBeNull();
  });
});
