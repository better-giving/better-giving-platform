import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import type { IReg } from "@/reg";
import { ProgressIndicator } from "./progress-indicator";

afterEach(reset_viewport);

async function render_at(
  url_step: number,
  o_type: IReg["o_type"],
  step: 1 | 2 | 3 | 4 | 5
) {
  const Stub = createRoutesStub([
    {
      path: "/register/:reg_id/:step",
      HydrateFallback: () => null,
      Component: () => <ProgressIndicator step={step} o_type={o_type} />,
    },
  ]);
  const screen = await render(
    <Stub initialEntries={[`/register/abc/${url_step}`]} />
  );
  return {
    labels: [...screen.container.querySelectorAll("[data-scope='steps'] span")]
      .map((el) => el.textContent?.trim())
      .filter(Boolean),
    current: screen.container.querySelector("[data-curr]")?.textContent?.trim(),
    // rows are display:none below md, so read the mark off the dom rather
    // than off visibility — the shading is what it drives
    complete: [...screen.container.querySelectorAll("[data-part='item']")].map(
      (el) => el.hasAttribute("data-complete")
    ),
  };
}

describe("ProgressIndicator", () => {
  it("gives a 501(c)(3) four steps with no agreement among them", async () => {
    expect((await render_at(4, "501c3", 4)).labels).toEqual([
      "Contact Details",
      "Organization",
      "Banking",
      "Review",
    ]);
  });

  it("gives an international org five steps including the agreement", async () => {
    expect((await render_at(4, "other", 4)).labels).toEqual([
      "Contact Details",
      "Organization",
      "Fiscal Sponsorship",
      "Banking",
      "Review",
    ]);
  });

  // url step 4 is banking for everyone, but it is the 3rd label for a
  // 501(c)(3) and the 4th for an international org — get the shift wrong and
  // the highlight sits on the wrong row for every US applicant past step 2.
  it("highlights banking at url step 4 for a 501(c)(3)", async () => {
    expect((await render_at(4, "501c3", 4)).current).toContain("Banking");
  });

  it("highlights banking at url step 4 for an international org", async () => {
    expect((await render_at(4, "other", 4)).current).toContain("Banking");
  });

  it("highlights review at url step 5 for a 501(c)(3)", async () => {
    expect((await render_at(5, "501c3", 5)).current).toContain("Review");
  });

  it("highlights review at url step 5 for an international org", async () => {
    expect((await render_at(5, "other", 5)).current).toContain("Review");
  });

  it("highlights the agreement at url step 3 for an international org", async () => {
    expect((await render_at(3, "other", 3)).current).toContain(
      "Fiscal Sponsorship"
    );
  });

  it("highlights contact at url step 1", async () => {
    expect((await render_at(1, "501c3", 1)).current).toContain(
      "Contact Details"
    );
  });

  it("shades the steps behind the current one", async () => {
    expect((await render_at(2, "501c3", 2)).complete).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("shades the agreement once an international org is past it", async () => {
    expect((await render_at(4, "other", 4)).complete).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  // the recorded step can sit ahead of the page being viewed
  it("keeps later steps shaded when an applicant walks back", async () => {
    expect((await render_at(2, "501c3", 4)).complete).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  // collapsed below md the current row shows alone, so a connector above it
  // would hang off nothing
  it("draws no connector above the lone row when collapsed on a phone", async () => {
    await page.viewport(390, 844);
    const Stub = createRoutesStub([
      {
        path: "/register/:reg_id/:step",
        HydrateFallback: () => null,
        Component: () => <ProgressIndicator step={2} o_type="501c3" />,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/register/abc/2"]} />);
    const connector = () =>
      screen.container.querySelector<HTMLElement>(
        "[data-curr] > div:first-child"
      );
    await expect.poll(() => connector()).not.toBeNull();
    expect(getComputedStyle(connector()!).display).toBe("none");

    await userEvent.click(screen.getByRole("button", { name: "Expand steps" }));
    await expect
      .poll(() => getComputedStyle(connector()!).display)
      .not.toBe("none");
  });
});
