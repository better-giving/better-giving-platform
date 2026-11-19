import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { sections } from "./data";
import { EthicsChecklist, STORAGE_KEY } from "./ethics-checklist";

const items = sections.flatMap((s) => s.items);
const total = items.length;
const flag_total = items.filter((i) => i.flag).length;

// a flashpoint and a plain item, addressed by the copy a visitor actually reads
const FLASHPOINT = /written consent from an authorized representative/;
const PLAIN = /Campaign pages link to our own website/;

beforeEach(() => localStorage.removeItem(STORAGE_KEY));
afterEach(() => localStorage.removeItem(STORAGE_KEY));

describe("data", () => {
  test("28 questions, 10 of them flashpoints", () => {
    expect(total).toBe(28);
    expect(flag_total).toBe(10);
  });
});

describe("EthicsChecklist", () => {
  test("starts empty, with every question on the page", async () => {
    const screen = await render(<EthicsChecklist />);

    expect(
      screen.container.querySelectorAll("input[type=checkbox]")
    ).toHaveLength(28);
    await expect
      .element(screen.getByText("10 flashpoints to check"))
      .toBeVisible();
  });

  test("a ticked flashpoint counts twice: toward the score and off the tally", async () => {
    const screen = await render(<EthicsChecklist />);

    await screen.getByLabelText(FLASHPOINT).click();

    await expect
      .element(screen.getByText("9 flashpoints unchecked"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Gaps to raise with your platform"))
      .toBeVisible();
  });

  test("the last unticked flashpoint reads as 1 flashpoint unchecked", async () => {
    const flags = items.filter((i) => i.flag).map((i) => i.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags.slice(1)));

    const screen = await render(<EthicsChecklist />);

    await expect
      .element(screen.getByText("1 flashpoint unchecked"))
      .toBeVisible();
  });

  test("every flashpoint ticked with items left is its own verdict", async () => {
    const flags = items.filter((i) => i.flag).map((i) => i.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));

    const screen = await render(<EthicsChecklist />);

    await expect
      .element(screen.getByText("No red flags, with a few items left"))
      .toBeVisible();
    await expect
      .element(screen.getByText("All flashpoints clear"))
      .toBeVisible();
  });

  test("only a full sheet meets every principle", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map((i) => i.id)));

    const screen = await render(<EthicsChecklist />);

    await expect
      .element(screen.getByText("Meets every principle"))
      .toBeVisible();
  });

  test("a tick is written to the store", async () => {
    const screen = await render(<EthicsChecklist />);

    await screen.getByLabelText(PLAIN).click();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "partnership-links-out",
    ]);
  });

  test("a stored tick comes back on the next visit", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["partnership-links-out"])
    );

    const screen = await render(<EthicsChecklist />);

    await expect.element(screen.getByLabelText(PLAIN)).toBeChecked();
  });

  test("an id that no longer exists is dropped, never counted", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["gone", "consent-branding"])
    );

    const screen = await render(<EthicsChecklist />);

    // 1, not 2: a stale id would push the score past the question count
    await expect.element(screen.getByText("1 of 28 checked")).toBeVisible();
  });

  test("Reset all is aria-disabled while nothing is ticked", async () => {
    const screen = await render(<EthicsChecklist />);

    await expect
      .element(screen.getByRole("button", { name: "Reset all" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  test("Keep my ticks leaves the store as it was", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["partnership-links-out"])
    );
    const screen = await render(<EthicsChecklist />);

    await screen.getByRole("button", { name: "Reset all" }).click();
    await screen.getByRole("button", { name: "Keep my ticks" }).click();

    await expect.element(screen.getByLabelText(PLAIN)).toBeChecked();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "partnership-links-out",
    ]);
  });

  test("Clear all ticks unticks the page and writes an empty list", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["partnership-links-out"])
    );
    const screen = await render(<EthicsChecklist />);

    await screen.getByRole("button", { name: "Reset all" }).click();
    await screen.getByRole("button", { name: "Clear all ticks" }).click();

    await expect.element(screen.getByLabelText(PLAIN)).not.toBeChecked();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });
});
