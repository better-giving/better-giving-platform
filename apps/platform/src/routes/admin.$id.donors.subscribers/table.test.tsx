import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { type ISubRow, SubscribersTable } from "./table";

const row = (name: string, pend_year: number): ISubRow => ({
  from_email: `${name.toLowerCase()}@example.com`,
  from_name: name,
  active_count: 1,
  billed_month: 10,
  pend_month: 0,
  pend_year,
});

describe("subscriber column headers", () => {
  test("an info tip sits beside its sort button, not inside it, and the sort still works", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/donors/subscribers",
        Component: () => (
          <SubscribersTable items={[row("Ann", 50), row("Bo", 900)]} />
        ),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/admin/1/donors/subscribers"]} />
    );

    await expect.element(screen.getByRole("table")).toBeVisible();
    expect(screen.container.querySelectorAll("button button")).toHaveLength(0);

    await screen
      .getByRole("button", { name: "Pending this year", exact: true })
      .click();
    await vi.waitFor(() => {
      const names = [...screen.container.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelector(".font-medium")?.textContent
      );
      expect(names).toEqual(["Bo", "Ann"]);
    });
  });
});
