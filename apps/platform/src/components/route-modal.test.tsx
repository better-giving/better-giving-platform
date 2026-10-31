import { useState } from "react";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { RouteModal } from "./route-modal";

function Modal() {
  return (
    <RouteModal classes="bg-card p-4">
      <h3>Refund preview</h3>
      <p>modal body</p>
    </RouteModal>
  );
}

function stub(Child = Modal) {
  return createRoutesStub([
    {
      path: "/parent",
      Component: () => (
        <div>
          <p>parent route</p>
          <Outlet />
        </div>
      ),
      children: [
        {
          path: "child",
          Component: Child,
          HydrateFallback: () => null,
        },
      ],
    },
  ]);
}

describe("RouteModal", () => {
  test("renders children inside a portal", async () => {
    const Stub = stub();
    const screen = await render(
      <Stub
        initialEntries={["/parent/child"]}
        future={{ v8_middleware: true }}
      />
    );
    await expect.element(screen.getByText("modal body")).toBeVisible();
    await expect.element(screen.getByText("parent route")).toBeVisible();
  });

  test("is named by its first heading, or by an explicit title", async () => {
    const Stub = stub();
    const screen = await render(
      <Stub
        initialEntries={["/parent/child"]}
        future={{ v8_middleware: true }}
      />
    );
    await expect
      .element(
        screen.getByRole("dialog", { name: "Refund preview", exact: true })
      )
      .toBeVisible();
    await cleanup();

    const Titled = stub(() => (
      <RouteModal title="Edit allocation">
        <p>modal body</p>
      </RouteModal>
    ));
    const titled = await render(
      <Titled
        initialEntries={["/parent/child"]}
        future={{ v8_middleware: true }}
      />
    );
    await expect
      .element(
        titled.getByRole("dialog", { name: "Edit allocation", exact: true })
      )
      .toBeVisible();
  });

  test("while busy, Escape leaves it open; once not busy, Escape closes it", async () => {
    function Busy() {
      const [busy, set_busy] = useState(false);
      return (
        <RouteModal busy={busy}>
          <h3>Refund preview</h3>
          <button type="button" onClick={() => set_busy((b) => !b)}>
            {busy ? "Settle" : "Hold"}
          </button>
          <p>modal body</p>
        </RouteModal>
      );
    }
    const Stub = stub(Busy);
    const screen = await render(
      <Stub
        initialEntries={["/parent/child"]}
        future={{ v8_middleware: true }}
      />
    );
    const press = (name: string) =>
      (screen.getByRole("button", { name }).element() as HTMLElement).click();
    const press_escape = () =>
      document.dispatchEvent(
        // cancelable, as a real key press is: ark holds the dialog by preventing it
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      );

    await expect.element(screen.getByText("modal body")).toBeVisible();
    press("Hold");
    await expect
      .element(screen.getByRole("button", { name: "Settle" }))
      .toBeVisible();
    // spread over frames, so at least one lands after ark's deferred listener
    for (let i = 0; i < 5; i++) {
      press_escape();
      await new Promise((r) => requestAnimationFrame(r));
    }
    await expect.element(screen.getByText("modal body")).toBeVisible();

    press("Settle");
    await vi.waitFor(() => {
      press_escape();
      expect(document.body).not.toMatchTextContent("modal body");
    });
  });

  test("Escape closes by navigating to parent (default '..')", async () => {
    const Stub = stub();
    const screen = await render(
      <Stub
        initialEntries={["/parent/child"]}
        future={{ v8_middleware: true }}
      />
    );
    await expect.element(screen.getByText("modal body")).toBeVisible();
    // ark dismissable layer attaches its document-level escape listener via
    // a deferred raf, so retry the keydown until the modal actually unmounts.
    await vi.waitFor(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      expect(document.body).not.toMatchTextContent("modal body");
    });
  });
});
