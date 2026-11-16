import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { CtaBand } from "./cta-band";

const render_band = (props: Parameters<typeof CtaBand>[0]) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <CtaBand {...props} /> },
    { path: "/register", Component: () => null },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("CtaBand", () => {
  test("by default it keeps its subtitle and both asks", async () => {
    const screen = await render_band({ title: "Title", subtitle: "Sub line" });
    await expect.element(screen.getByText("Sub line")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Join free forever" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Book a demo" }))
      .toBeInTheDocument();
  });

  test("with no subtitle and show_demo off it draws the title and one ask", async () => {
    const screen = await render_band({ title: "Title", show_demo: false });
    expect(screen.container.querySelector("p")).toBeNull();
    expect(screen.container.querySelectorAll("a")).toHaveLength(1);
    expect(screen.container.textContent).not.toContain("Book a demo");
  });
});
