import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DeleteForm } from "./delete-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member remove", () => {
  test("names the person and asks before removing them", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/members",
        Component: () => <DeleteForm to_remove="ada" label="ada@example.com" />,
        HydrateFallback: () => null,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/admin/1/members"]} />);
    await screen
      .getByRole("button", { name: "Remove ada@example.com" })
      .click();
    expect(confirm).toHaveBeenCalledWith(
      "Are you sure you want to remove ada@example.com?"
    );
  });
});
