import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CpfToggle } from "./cpf-toggle";
import { Frequency } from "./frequency";
import { TipField } from "./tip-field";

vi.mock("../context", () => ({
  use_donation: vi.fn().mockReturnValue({
    don: { base_url: "https://test.example.com" },
    don_set: vi.fn(),
  }),
}));

// ark puts focus on the hidden input and marks the visible part with
// `data-focus-visible`; tab until the part carries it
async function tab_to(part: Element) {
  for (let i = 0; i < 20 && !part.hasAttribute("data-focus-visible"); i++) {
    await userEvent.tab();
  }
  expect(part.hasAttribute("data-focus-visible")).toBe(true);
  // the switches' transition-colors eases outline-color too; the style read
  // starts it, so its animation exists to await before the ring is read
  getComputedStyle(part).outlineColor;
  await Promise.all(part.getAnimations().map((a) => a.finished));
}

const ring = (el: Element) => {
  const s = getComputedStyle(el);
  return {
    style: s.outlineStyle,
    width: s.outlineWidth,
    color: s.outlineColor,
    offset: s.outlineOffset,
  };
};

const part_of = (label: Element, scope: string, part: string) =>
  label
    .closest(`[data-scope="${scope}"][data-part="root"]`)
    ?.querySelector(`[data-part="${part}"]`) as Element;

const item_of = (text: Element) =>
  text.closest('[data-scope="radio-group"][data-part="item"]') as Element;

describe("donation form controls under keyboard focus", () => {
  test("the tip switch, fee switch and frequency options ring like the tip radios", async () => {
    const screen = await render(
      <div id="donation-container">
        <TipField
          checked={false}
          checked_changed={() => {}}
          tip_format="10"
          tip_format_changed={() => {}}
          custom_tip={undefined}
          nudge={false}
        />
        <CpfToggle checked={false} checked_changed={() => {}} />
        <Frequency opts={undefined} value="one-time" onChange={() => {}} />
      </div>
    );

    const tip_switch = part_of(
      screen.getByText("Support free fundraising tools").element(),
      "switch",
      "control"
    );
    const tip_radio = item_of(
      screen.getByText("10%", { exact: true }).element()
    );
    const fee_switch = part_of(
      screen.getByText("Cover 3rd party processing fees").element(),
      "switch",
      "control"
    );
    const freq_option = item_of(screen.getByText("Give once").element());

    // document order, so each is one forward tab run from the last
    const rings = [];
    for (const part of [tip_switch, tip_radio, fee_switch, freq_option]) {
      await tab_to(part);
      rings.push(ring(part));
    }

    const [switch_ring, radio_ring, fee_ring, freq_ring] = rings;
    expect(radio_ring).toMatchObject({ style: "solid", width: "2px" });
    expect(switch_ring).toEqual(radio_ring);
    expect(fee_ring).toEqual(radio_ring);
    expect(freq_ring).toEqual(radio_ring);
  });
});
