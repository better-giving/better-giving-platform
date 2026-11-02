import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MultiCombo } from "./multi-combo";

const countries = ["Argentina", "Brazil", "Chile", "Denmark"];

function Harness(p: { on_change?: (v: string[]) => void; initial?: string[] }) {
  const [values, set_values] = useState<string[]>(p.initial ?? []);
  return (
    <>
      <button type="button">before</button>
      <MultiCombo
        values={values}
        options={countries}
        on_change={(v) => {
          set_values(v);
          p.on_change?.(v);
        }}
        on_reset={() => set_values([])}
      />
    </>
  );
}

describe("MultiCombo", () => {
  // the control exposes exactly one tab stop and no stand-in inputs: a stray
  // tabbable element or a tabIndex=-1 ref holder would both pass a render
  // check and fail here.
  test("tab reaches the control, arrows + enter select", async () => {
    const on_change = vi.fn();
    const screen = await render(<Harness on_change={on_change} />);

    await screen.getByRole("button", { name: "before" }).click();
    await userEvent.tab();
    await expect.element(screen.getByRole("combobox")).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("option", { name: "Argentina" }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");

    expect(on_change).toHaveBeenCalledWith(["Argentina"]);
  });

  test("a selected value renders a tag whose remove button deselects", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <Harness initial={["Brazil"]} on_change={on_change} />
    );

    await expect.element(screen.getByText("Brazil").first()).toBeVisible();
    // by name, not by index: in a row of identical X glyphs the name is the
    // only thing telling one tag's remove button from the next one's
    await screen.getByRole("button", { name: "Remove Brazil" }).click();
    expect(on_change).toHaveBeenCalledWith([]);
  });

  test("the remove button is named from item_text, not from the rendered tag", async () => {
    interface Org {
      id: string;
      name: string;
    }
    const orgs: Org[] = [
      { id: "a", name: "Wildlife Fund" },
      { id: "b", name: "Ocean Trust" },
    ];
    const on_change = vi.fn();

    const screen = await render(
      <MultiCombo<Org>
        values={[orgs[0]]}
        options={orgs}
        on_change={on_change}
        item_key={(o) => o.id}
        item_text={(o) => o.name}
        // the tag shows a glyph and nothing readable — exactly the case where
        // the label cannot double as the control's name
        render={(o) => <span aria-hidden="true">{o.name.charAt(0)}</span>}
      />
    );

    await screen.getByRole("button", { name: "Remove Wildlife Fund" }).click();
    expect(on_change).toHaveBeenCalledWith([]);
  });

  test("select all, then deselect all", async () => {
    const on_change = vi.fn();
    const screen = await render(<Harness on_change={on_change} />);

    await screen.getByRole("combobox").click();
    await screen.getByRole("button", { name: "Select all" }).click();
    expect(on_change).toHaveBeenCalledWith(countries);

    await screen.getByRole("button", { name: "Deselect all" }).click();
    expect(on_change).toHaveBeenCalledWith([]);
  });

  test("typing filters; no match shows the status line", async () => {
    const screen = await render(<Harness />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    expect(screen.getByRole("option").elements().length).toBe(4);

    await combo.fill("bra");
    expect(screen.getByRole("option").elements().length).toBe(1);

    await combo.fill("zzz");
    expect(screen.getByRole("option").query()).toBeNull();
    await expect.element(screen.getByText("zzz not found")).toBeVisible();
  });

  test("a selected option filtered out of the query still renders", async () => {
    const screen = await render(<Harness initial={["Argentina"]} />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await combo.fill("chi");

    // Chile matched; Argentina is rehydrated so the value stays resolvable
    await expect
      .element(screen.getByRole("option", { name: "Chile" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: /Argentina/ }))
      .toBeVisible();
  });
});

// same gap as `Combo`: the control paints `aria-invalid` and the message sits
// under it unlinked, because zag's input takes no describedby off the field.
describe("MultiCombo: error announcement", () => {
  test("names the message as the input's description", async () => {
    const screen = await render(
      <MultiCombo
        label="Countries"
        values={[]}
        options={countries}
        on_change={() => {}}
        error="Pick at least one"
      />
    );

    await expect
      .element(screen.getByRole("combobox"))
      .toHaveAccessibleDescription("Pick at least one");
  });

  test("describes nothing when there is no error", async () => {
    const screen = await render(
      <MultiCombo
        label="Countries"
        values={[]}
        options={countries}
        on_change={() => {}}
      />
    );

    await expect
      .element(screen.getByRole("combobox"))
      .toHaveAccessibleDescription("");
  });
});
