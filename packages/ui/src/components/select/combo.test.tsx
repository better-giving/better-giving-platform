import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Combo } from "./combo";
import type { SyncSource } from "./types";

const countries = ["Argentina", "Brazil", "Chile", "Denmark"];

function RhfHarness() {
  const { watch, setValue, reset } = useForm<{ country: string }>({
    defaultValues: { country: "" },
  });
  const country = watch("country");
  return (
    <>
      {/* above the control: the popup opens downward and would swallow the click */}
      <p data-testid="outside">outside</p>
      <Combo
        value={country || undefined}
        on_change={(c) => setValue("country", c ?? "")}
        options={countries}
        placeholder="Select a country"
        adornment={() => <span>drawer</span>}
      />
      <button type="button" onClick={() => reset({ country: "Chile" })}>
        reset-chile
      </button>
      <button type="button" onClick={() => reset({ country: "" })}>
        reset-empty
      </button>
    </>
  );
}

describe("Combo", () => {
  // the reason `inputValue` is left uncontrolled. zag's watch() tracks the
  // value and re-runs syncSelectedItems, which restringifies the input text
  // through the collection — controlling inputValue is what turns that off.
  test("input text follows an externally changed value", async () => {
    const screen = await render(<RhfHarness />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await screen.getByRole("option", { name: "Argentina" }).click();
    await expect.element(combo).toHaveValue("Argentina");

    await screen.getByRole("button", { name: "reset-chile" }).click();
    await expect.element(combo).toHaveValue("Chile");

    await screen.getByRole("button", { name: "reset-empty" }).click();
    await expect.element(combo).toHaveValue("");
  });

  // zag reverts typed-but-unselected text on click-outside only. a trigger
  // click leaves it stale, which is what SelectedInputSync exists to fix.
  test("closing without picking restores the selected text", async () => {
    const screen = await render(<RhfHarness />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await screen.getByRole("option", { name: "Argentina" }).click();

    // zag's own path: LAYER.INTERACT_OUTSIDE → revertInputValue
    await combo.fill("Den");
    await screen.getByTestId("outside").click();
    await expect.element(combo).toHaveValue("Argentina");

    // the path zag leaves alone: TRIGGER.CLICK closes without reverting
    await combo.fill("Bra");
    await expect.element(combo).toHaveValue("Bra");
    // ark names the trigger "Toggle suggestions"; it is the first button here
    await screen.getByRole("button").first().click();
    await expect.element(combo).toHaveValue("Argentina");
  });

  test("a selected option the query filters out stays resolvable", async () => {
    const screen = await render(<RhfHarness />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await screen.getByRole("option", { name: "Argentina" }).click();

    await combo.fill("Chi");
    // rehydrated into the collection, so the text has a label to revert to
    await expect
      .element(screen.getByRole("option", { name: "Argentina" }))
      .toBeVisible();
    await screen.getByTestId("outside").click();
    await expect.element(combo).toHaveValue("Argentina");
  });

  test("clear emits undefined and fires on_reset", async () => {
    const on_change = vi.fn();
    const on_reset = vi.fn();
    function H() {
      const [v, set_v] = useState<string | undefined>("Brazil");
      return (
        <Combo
          value={v}
          on_change={(c) => {
            set_v(c);
            on_change(c);
          }}
          on_reset={on_reset}
          clearable
          options={countries}
        />
      );
    }
    const screen = await render(<H />);
    await screen.getByRole("button").last().click();

    expect(on_reset).toHaveBeenCalled();
    expect(on_change).toHaveBeenCalledWith(undefined);
  });

  test("a lead sits at the leading edge, hidden from assistive tech, and a click on it opens the list", async () => {
    const screen = await render(
      <Combo
        value="Brazil"
        on_change={() => {}}
        options={countries}
        lead={<span data-testid="flag">BR</span>}
        adornment={() => <span>drawer</span>}
      />
    );
    const input = screen.getByRole("combobox");
    const flag = screen.getByTestId("flag");
    expect(flag.element().parentElement?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    const lead_box = flag.element().getBoundingClientRect();
    const input_box = input.element().getBoundingClientRect();
    expect(lead_box.left).toBeLessThan(input_box.left + input_box.width / 2);
    expect(getComputedStyle(input.element()).paddingLeft).toBe("48px");
    // force: the lead takes no pointer events, so the press lands on the input
    await flag.click({ force: true });
    await expect.element(screen.getByRole("listbox")).toBeVisible();
  });

  test("limit caps the rows; a custom filter replaces the matcher", async () => {
    const screen = await render(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={countries}
        limit={2}
        // whitespace-insensitive, the currency matcher's shape
        filter={(text, q) =>
          text.toLowerCase().replace(/\s+/g, "").includes(q.toLowerCase())
        }
      />
    );
    const combo = screen.getByRole("combobox");

    await combo.click();
    expect(screen.getByRole("option").elements().length).toBe(2);

    await combo.fill("zil");
    await expect
      .element(screen.getByRole("option", { name: "Brazil" }))
      .toBeVisible();
  });

  // zag's revert guards are all `not("allowCustomValue")`, and SelectedInputSync
  // reverts on paths zag leaves alone — mounting it here would delete the text
  // that IS the value.
  test("allow_custom offers the typed text and keeps it through a close", async () => {
    const on_change = vi.fn();
    function H() {
      const [v, set_v] = useState<string | undefined>();
      return (
        <>
          <p data-testid="outside">outside</p>
          <Combo
            value={v}
            on_change={(c) => {
              set_v(c);
              on_change(c);
            }}
            options={countries}
            allow_custom
            adornment={() => <span>drawer</span>}
          />
        </>
      );
    }
    const screen = await render(<H />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await combo.fill("Ontario");
    // `allowCustomValue` never emits a value on its own — the row does
    await screen.getByRole("option", { name: "Ontario" }).click();
    expect(on_change).toHaveBeenCalledWith("Ontario");
    await expect.element(combo).toHaveValue("Ontario");

    // the close zag leaves alone, and the one SelectedInputSync exists to
    // cover — it has to leave a custom value where the donor typed it.
    // ark names the trigger "Toggle suggestions"; it is the first button here
    await combo.fill("Manitoba");
    await screen.getByRole("button").first().click();
    await expect.element(combo).toHaveValue("Manitoba");

    // and zag's own revert path, guarded by `not("allowCustomValue")`
    await combo.fill("Saskatchewan");
    await screen.getByTestId("outside").click();
    await expect.element(combo).toHaveValue("Saskatchewan");
  });

  test("a query source disables the control while it loads or fails", async () => {
    const loading: SyncSource<string> = { items: [], loading: true };
    const screen = await render(
      <Combo value={undefined} on_change={() => {}} options={loading} />
    );
    await expect.element(screen.getByRole("combobox")).toBeDisabled();

    await screen.rerender(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={{ items: [], error: "nope" }}
      />
    );
    await expect.element(screen.getByRole("combobox")).toBeDisabled();

    await screen.rerender(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={{ items: countries }}
      />
    );
    await expect.element(screen.getByRole("combobox")).toBeEnabled();
  });
});

/**
 * the contract the embedded donation form's currency control needs: an object
 * option type read through `item_key`/`item_text`, and an externally set value
 * the input text has to follow (both stripe forms seed `currency` from
 * `usd_option`, then `setValue` it from the preferred-currency fetch).
 */
describe("Combo over object options", () => {
  const currencies = [
    { code: "USD" },
    { code: "EUR" },
    { code: "GBP" },
    { code: "CAD" },
    { code: "AUD" },
  ];
  type Currency = (typeof currencies)[number];

  function setup(value: Currency | undefined = currencies[0]) {
    const on_change = vi.fn();
    return {
      on_change,
      props: {
        value,
        on_change,
        options: currencies,
        item_key: (t: Currency) => t.code,
        item_text: (t: Currency) => t.code,
        placeholder: "Currency",
        adornment: (open: boolean) => <span>{open ? "▲" : "▼"}</span>,
      },
    };
  }

  test("select EUR, reopen → all options visible", async () => {
    const { props, on_change } = setup();
    const screen = await render(<Combo {...props} />);

    await screen.getByRole("combobox").click();
    await expect
      .element(screen.getByRole("option", { name: "EUR" }))
      .toBeVisible();
    expect(screen.getByRole("option").elements().length).toBe(5);

    await screen.getByRole("option", { name: "EUR" }).click();
    expect(on_change).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EUR" })
    );

    // a pick is not a search: zag reports `item-select`, so the query resets
    // and the reopened list is unfiltered again
    await screen.rerender(<Combo {...props} value={currencies[1]} />);
    await screen.getByRole("combobox").click();
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
    expect(screen.getByRole("option").elements().length).toBe(5);
  });

  test("typing filters options, clearing restores all", async () => {
    const { props } = setup();
    const screen = await render(<Combo {...props} />);

    const combo = screen.getByRole("combobox");
    await combo.click();
    expect(screen.getByRole("option").elements().length).toBe(5);

    await combo.fill("EU");
    await expect
      .element(screen.getByRole("option", { name: "EUR" }))
      .toBeVisible();
    // the match, plus the selected USD rehydrated by `use_collection` — a
    // selection the filter drops has no label left to restore the input from
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
    expect(screen.getByRole("option").elements().length).toBe(2);

    await combo.fill("");
    expect(screen.getByRole("option").elements().length).toBe(5);
  });

  test("an empty list says so; a query nothing matches names the query", async () => {
    // nothing selected: a rehydrated selection would BE a row, and the status
    // line only stands in where there are none
    const { props } = setup();
    const screen = await render(
      <Combo {...props} value={undefined} options={[]} />
    );

    await screen.getByRole("combobox").click();
    await expect.element(screen.getByText("No options found")).toBeVisible();

    await screen.rerender(<Combo {...props} value={undefined} />);
    const combo = screen.getByRole("combobox");
    await combo.fill("xxxx");
    expect(screen.getByRole("option").query()).toBeNull();
    await expect.element(screen.getByText("xxxx not found")).toBeVisible();
  });

  // the whole reason `inputValue` stays uncontrolled — see SelectedInputSync
  test("input text follows an externally set value", async () => {
    function H() {
      const { watch, setValue } = useForm<{ currency: Currency }>({
        defaultValues: { currency: currencies[0] },
      });
      const { props } = setup();
      return (
        <>
          <Combo
            {...props}
            value={watch("currency")}
            on_change={(c) => {
              if (c) setValue("currency", c);
            }}
          />
          <button
            type="button"
            onClick={() => setValue("currency", currencies[2])}
          >
            prefer-gbp
          </button>
        </>
      );
    }
    const screen = await render(<H />);
    const combo = screen.getByRole("combobox");

    await expect.element(combo).toHaveValue("USD");
    await screen.getByRole("button", { name: "prefer-gbp" }).click();
    await expect.element(combo).toHaveValue("GBP");
  });
});

/**
 * the seam draws a full field box until a host says it owns the chrome. the
 * embedded donation form does — its combobox is the left cell of one bordered
 * box it shares with the amount input — and every other call site must be
 * untouched by that.
 */
describe("Combo chrome", () => {
  const classes = (el: Element) =>
    el.className.split(/\s+/).filter(Boolean).sort();

  test("classes.input replaces the field box rather than adding to it", async () => {
    const screen = await render(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={countries}
        adornment={() => <span>drawer</span>}
      />
    );
    const combo = screen.getByRole("combobox");
    expect(classes(combo.element())).toEqual(
      ["field-input", "w-full", "h-full", "pr-12"].sort()
    );

    await screen.rerender(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={countries}
        adornment={() => <span>drawer</span>}
        classes={{ input: "w-full text-sm bg-transparent px-4 py-3.5" }}
      />
    );
    expect(classes(combo.element())).toEqual(
      ["w-full", "text-sm", "bg-transparent", "px-4", "py-3.5"].sort()
    );
  });

  test("the popup tracks the control until popup_width says otherwise", async () => {
    const screen = await render(
      <Combo value={undefined} on_change={() => {}} options={countries} />
    );
    await screen.getByRole("combobox").click();
    const popup = screen.getByRole("listbox");
    expect(classes(popup.element())).toContain("w-(--reference-width)");

    await screen.rerender(
      <Combo
        value={undefined}
        on_change={() => {}}
        options={countries}
        popup_width="w-56"
      />
    );
    expect(classes(popup.element())).toContain("w-56");
    expect(classes(popup.element())).not.toContain("w-(--reference-width)");
  });
});

/**
 * the arm the embedded donation form's token/ticker control needs: the module
 * runs the search itself, one request at a time, and the popup renders the same
 * four states it renders for a list the caller already holds.
 */
describe("Combo over an async source", () => {
  interface Currency {
    code: string;
    label: string;
  }

  const currencies: Currency[] = [
    { code: "USD", label: "USD" },
    { code: "EUR", label: "EUR" },
    { code: "GBP", label: "GBP" },
    { code: "CAD", label: "CAD" },
    { code: "AUD", label: "AUD" },
  ];

  function setup(value: Currency | undefined = currencies[0]) {
    const on_change = vi.fn();
    const search =
      vi.fn<(q: string, signal: AbortSignal) => Promise<Currency[]>>();
    // default: the source answers every query with everything
    search.mockResolvedValue(currencies);

    return {
      on_change,
      search,
      props: {
        value,
        on_change,
        options: { search },
        item_key: (t: Currency) => t.code,
        item_text: (t: Currency) => t.label,
        placeholder: "Search token",
        // the adornment reads the source's state, so it doubles as the probe
        adornment: (open: boolean, state: string) =>
          state === "idle" ? (
            <span>{open ? "▲" : "▼"}</span>
          ) : (
            <span>{state}</span>
          ),
      },
    };
  }

  test("opening searches the empty query; picking a row spends no request", async () => {
    const { props, on_change, search } = setup();
    const screen = await render(<Combo {...props} />);

    await screen.getByRole("combobox").click();
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
    expect(search).toHaveBeenCalledWith("", expect.any(AbortSignal));
    expect(screen.getByRole("option").elements().length).toBe(5);

    await screen.getByRole("option", { name: "EUR" }).click();
    expect(on_change).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EUR" })
    );
    // zag reports `item-select`, and the text it leaves behind is the value,
    // not a query — a request per selection is what this pins down
    expect(search).toHaveBeenCalledTimes(1);

    search.mockClear();
    await screen.rerender(<Combo {...props} value={currencies[1]} />);
    await screen.getByRole("combobox").click();

    expect(search).toHaveBeenCalledWith("", expect.any(AbortSignal));
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
    expect(screen.getByRole("option").elements().length).toBe(5);
  });

  test("the source owns the matching, and names a query it answers with nothing", async () => {
    const { props, search } = setup();
    const screen = await render(<Combo {...props} />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();

    // a row whose text does not contain the query is still a row: the module
    // never filters what a search returned
    search.mockResolvedValue([currencies[2]!]);
    await combo.fill("pound");
    // the query is spent one typing pause after the keystroke, not on it
    await vi.waitFor(() =>
      expect(search).toHaveBeenCalledWith("pound", expect.any(AbortSignal))
    );
    await expect
      .element(screen.getByRole("option", { name: "GBP" }))
      .toBeVisible();

    search.mockResolvedValue([]);
    await combo.fill("XYZ");
    await expect.element(screen.getByText("XYZ not found")).toBeVisible();
    // said over the rehydrated selection, which matched nothing either
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
  });

  test("typing into a closed box searches the typed text, not the empty query", async () => {
    const { props, search } = setup();
    search.mockImplementation(async (q) =>
      currencies.filter((c) => c.code.includes(q.toUpperCase()))
    );
    // nothing selected, so no row is rehydrated on top of the answer
    const screen = await render(<Combo {...props} value={undefined} />);

    // no click first: the keystroke is what opens the popup, and the open
    // must not answer with the whole list on top of the query just typed
    await screen.getByRole("combobox").fill("gb");
    await expect
      .element(screen.getByRole("option", { name: "GBP" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .not.toBeInTheDocument();
  });

  test("a search in flight says so and leaves the control usable", async () => {
    const { props, search } = setup();
    // never resolves: the pending state has to hold on its own
    search.mockReturnValue(new Promise(() => {}));
    const screen = await render(<Combo {...props} />);

    await screen.getByRole("combobox").click();

    await expect.element(screen.getByText("Searching…")).toBeVisible();
    await expect.element(screen.getByText("loading")).toBeVisible();
    // one request in flight is not a source with nothing to offer — disabling
    // here would take the field away mid-keystroke
    await expect.element(screen.getByRole("combobox")).toBeEnabled();
  });

  test("a failed search says so and leaves the control usable", async () => {
    const { props, search } = setup();
    search.mockRejectedValue(new Error("network"));
    const screen = await render(<Combo {...props} />);

    await screen.getByRole("combobox").click();

    await expect
      .element(screen.getByText("Failed to load options"))
      .toBeVisible();
    await expect.element(screen.getByText("error")).toBeVisible();
    // the way out of a failed search is typing another one
    await expect.element(screen.getByRole("combobox")).toBeEnabled();
  });

  test("a search aborts the one before it, and so does emptying the box", async () => {
    const { props, search } = setup();
    const signals: AbortSignal[] = [];
    search.mockImplementation((_q, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const screen = await render(<Combo {...props} />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await combo.fill("EU");
    await vi.waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    // the answer to a query the donor just deleted must not land on the list
    // that replaced it — and deleting is not itself a search
    await combo.fill("");
    await vi.waitFor(() => expect(signals[1]!.aborted).toBe(true));
    expect(search).toHaveBeenCalledTimes(2);
  });

  test("a burst of keystrokes spends one request, for the whole query", async () => {
    const { props, search } = setup();
    const screen = await render(<Combo {...props} />);
    const combo = screen.getByRole("combobox");

    await combo.click();
    await expect
      .element(screen.getByRole("option", { name: "USD" }))
      .toBeVisible();
    // the box opens holding the selection's text; typing would append to it
    await combo.fill("");

    search.mockClear();
    search.mockResolvedValue([currencies[1]!]);
    // character by character, the way it is actually typed: `fill` lands the
    // whole string in one event and could not tell a coalesced source from one
    // that fetches per keystroke
    await userEvent.type(combo.element() as HTMLElement, "euro");

    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    // and the one request is for what was typed, not for a prefix of it
    expect(search).toHaveBeenCalledWith("euro", expect.any(AbortSignal));
    await expect
      .element(screen.getByRole("option", { name: "EUR" }))
      .toBeVisible();
    // nothing lands late — the four characters were one query, not four
    expect(search).toHaveBeenCalledTimes(1);
  });
});

// zag's combobox input carries `aria-invalid` but never points at a reason:
// it reads only id, disabled, readOnly, required and invalid off the field
// context, so nothing links the message to the control unless we do.
describe("Combo: error announcement", () => {
  test("names the message as the input's description", async () => {
    const screen = await render(
      <Combo
        label="Country"
        value={undefined}
        on_change={() => {}}
        options={countries}
        error="Pick a country"
      />
    );

    await expect
      .element(screen.getByRole("combobox"))
      .toHaveAccessibleDescription("Pick a country");
  });

  test("describes nothing when there is no error", async () => {
    const screen = await render(
      <Combo
        label="Country"
        value={undefined}
        on_change={() => {}}
        options={countries}
      />
    );

    await expect
      .element(screen.getByRole("combobox"))
      .toHaveAccessibleDescription("");
  });
});
