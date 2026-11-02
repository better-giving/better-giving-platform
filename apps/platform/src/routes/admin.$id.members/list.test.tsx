import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { AuthUser } from "#/types/auth";
import { List } from "./list";

const me = { id: "keeper", email: "keeper@example.com" } as AuthUser;

const admins = [
  {
    id: "keeper",
    email: "keeper@example.com",
    first_name: "Kee",
    last_name: "Per",
    pending: false,
  },
  {
    id: "ada",
    email: "ada@example.com",
    first_name: "Ada",
    last_name: "L",
    pending: false,
  },
  {
    id: null,
    email: "invitee@example.com",
    first_name: null,
    last_name: null,
    pending: true,
  },
];

describe("members list", () => {
  test("offers to remove every member but the signed-in one", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/members",
        Component: () => <List user={me} admins={admins} />,
        HydrateFallback: () => null,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/admin/1/members"]} />);

    await expect
      .element(screen.getByRole("button", { name: "Remove ada@example.com" }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { name: "Remove invitee@example.com" })
      )
      .toBeVisible();
    // the row still lists them; only the control is gone
    await expect
      .element(screen.getByRole("row", { name: /keeper@example\.com/ }))
      .toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove keeper@example.com" }).query()
    ).toBeNull();
  });
});
