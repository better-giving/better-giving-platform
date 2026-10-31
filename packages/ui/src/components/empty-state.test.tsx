import { Inbox } from "lucide-react";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { EmptyRow, EmptyState } from "./empty-state";

describe("EmptyState", () => {
  test("renders the line and nothing else by default", async () => {
    const screen = await render(<EmptyState>No donors yet</EmptyState>);
    await expect.element(screen.getByText("No donors yet")).toBeVisible();
    // no heading, no action — the default is a line of muted text, because
    // most of these sit above a table somebody came to read
    expect(screen.container.querySelector("h3")).toBeNull();
  });

  test("the heading promotes it to a full treatment", async () => {
    const screen = await render(
      <EmptyState heading="No donations yet">
        Pick a nonprofit and make your first one.
      </EmptyState>
    );
    await expect
      .element(screen.getByRole("heading", { name: "No donations yet" }))
      .toBeVisible();
  });

  test("the icon slot renders above the heading", async () => {
    const screen = await render(
      <EmptyState
        heading="No donations yet"
        icon={<Inbox className="icon-xl" />}
      >
        Pick a nonprofit and make your first one.
      </EmptyState>
    );
    expect(screen.container.querySelector(".icon-xl")).not.toBeNull();
  });

  test("the action slot renders where there is a next step", async () => {
    const screen = await render(
      <EmptyState action={<a href="/marketplace">Browse nonprofits</a>}>
        No donations yet
      </EmptyState>
    );
    await expect
      .element(screen.getByRole("link", { name: "Browse nonprofits" }))
      .toBeVisible();
  });
});

describe("EmptyRow", () => {
  test("is a row a tbody will accept, spanning the table", async () => {
    const screen = await render(
      <table>
        <tbody>
          <EmptyRow col_span={4}>No payouts yet</EmptyRow>
        </tbody>
      </table>
    );
    const cell = screen.container.querySelector("td");
    expect(cell?.getAttribute("colspan")).toBe("4");
    // the browser reparents a <td> that is not inside a <tr>, so a row that
    // renders its cell bare would still show text and quietly lose the span
    expect(cell?.parentElement?.tagName).toBe("TR");
    await expect.element(screen.getByText("No payouts yet")).toBeVisible();
  });

  test("its line stays inside the visible width of a wide scrolling table", async () => {
    // a phone-width scroller over a table whose columns are far wider: the
    // line must land on screen, not centred across the scrolled-away columns
    const screen = await render(
      <div className="table-scroll" style={{ width: 358 }}>
        <table className="table" style={{ width: 1200 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Program</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            <EmptyRow col_span={3}>No donations found</EmptyRow>
          </tbody>
        </table>
      </div>
    );
    const line = screen.getByText("No donations found").element();
    const range = document.createRange();
    range.selectNodeContents(line);
    const text = range.getBoundingClientRect();
    const box = screen.container
      .querySelector(".table-scroll")
      ?.getBoundingClientRect();
    expect(text.width).toBeGreaterThan(0);
    expect(text.left).toBeGreaterThanOrEqual(box?.left ?? Number.NaN);
    expect(text.right).toBeLessThanOrEqual(box?.right ?? Number.NaN);
  });
});
