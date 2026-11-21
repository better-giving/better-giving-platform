import { describe, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render as render_dialog } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import {
  type IMarkWiredDialog,
  initial_focus,
  MarkWiredDialog,
} from "./mark-wired-dialog";
import type { IManualWireRow } from "./types";

/**
 * renders, then waits for the dialog's focus trap: it activates in a rAF after
 * mount and focuses the first tabbable, the date's month segment. typing
 * before that lets it pull focus mid-fill on a slow runner, and the digits
 * typed land in the date
 */
const render = async (ui: Parameters<typeof render_dialog>[0]) => {
  const screen = await render_dialog(ui);
  await expect.element(screen.getByRole("spinbutton").first()).toHaveFocus();
  return screen;
};

// native clicks: the dialog backdrop fails playwright's actionability check
const press = (el: Element) => (el as HTMLElement).click();

const TX = "7f3c2a1e-94b0-4d6e-a1c2-5b8e0d3f9a47";

const row: IManualWireRow = {
  npo_id: 1293826,
  name: "SXM Paws",
  gross: 4812.4,
  owed: 612.4,
  net: 4200,
  minimum: 100,
  bank: "USD account ending in 0412",
  payouts: [
    {
      id: "f3b1c0de-0000-4000-8000-00000000e8f4",
      label: "maya.okafor@brightmail.com",
      ref: "f3b1...e8f4",
      date: "2026-10-01T12:00:00.000Z",
      amount: 1904.1,
    },
    {
      id: "6d20c0de-0000-4000-8000-00000000d165",
      label: "Savings",
      ref: "6d20...d165",
      date: "2026-11-01T12:00:00.000Z",
      amount: 2908.3,
    },
  ],
};

const dialog_props = (o: Partial<IMarkWiredDialog> = {}): IMarkWiredDialog => ({
  open: true,
  row,
  submitting: false,
  on_submit: vi.fn(),
  on_close: vi.fn(),
  ...o,
});

/** the summary's labels, top to bottom */
const summary_rows = (screen: Awaited<ReturnType<typeof render>>) =>
  [...screen.getByLabelText("Summary").element().querySelectorAll("dt")].map(
    (dt) => dt.textContent
  );

const submit_button = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("button", { name: "Mark wired", exact: true });

describe("mark wired dialog", () => {
  test("names the nonprofit, preselects the one provider, lists the payouts and sums the wire live from the fee", async () => {
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    await expect
      .element(screen.getByRole("dialog", { name: "Mark wired", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("combobox", { name: "Provider" }))
      .toMatchTextContent("Mercury");

    // each payout reads label, masked ref, date, amount
    const payouts = screen.getByRole("list", { name: "Payouts settled" });
    await expect
      .element(payouts.getByRole("listitem").first())
      .toHaveTextContent(
        "maya.okafor@brightmail.comf3b1...e8f4Oct 1, 2026$1,904.10"
      );
    await expect
      .element(payouts.getByRole("listitem").nth(1))
      .toHaveTextContent("Savings6d20...d165Nov 1, 2026$2,908.30");

    const summary = screen.getByLabelText("Summary");
    await expect.element(summary).toMatchTextContent("Owed, deducted−$612.40");
    await expect.element(summary).toMatchTextContent("Wire fee−$0.00");
    await expect.element(summary).toMatchTextContent("Amount to send$4,200.00");

    await screen.getByLabelText("Wire fee").fill("25");
    await expect.element(summary).toMatchTextContent("Wire fee−$25.00");
    await expect.element(summary).toMatchTextContent("Amount to send$4,175.00");
    await expect.element(summary).toMatchTextContent("Balance debit$4,812.40");
  });

  test("owing, the summary deducts it, and the balance debit is the pending gross", async () => {
    const screen = await render(
      <MarkWiredDialog
        {...dialog_props({
          row: { ...row, gross: 500, owed: 93.2, net: 406.8 },
        })}
      />
    );
    const summary = screen.getByLabelText("Summary");
    await expect.element(summary).toMatchTextContent("Pending$500.00");
    await expect.element(summary).toMatchTextContent("Owed, deducted−$93.20");
    await expect.element(summary).toMatchTextContent("Net total$406.80");
    await expect.element(summary).toMatchTextContent("Balance debit$500.00");
    expect(summary_rows(screen)).toEqual([
      "Pending",
      "Owed, deducted",
      "Net total",
      "Wire fee",
      "Amount to send",
      "Balance debit",
    ]);
  });

  test.each([0, -12.5])(
    "owing nothing (owed %d), the summary has no owed row",
    async (owed) => {
      const screen = await render(
        <MarkWiredDialog
          {...dialog_props({
            row: { ...row, gross: 4200 - owed, owed, net: 4200 },
          })}
        />
      );
      await expect
        .element(screen.getByLabelText("Summary"))
        .toMatchTextContent("Net total$4,200.00");
      expect(summary_rows(screen)).toEqual([
        "Pending",
        "Net total",
        "Wire fee",
        "Amount to send",
        "Balance debit",
      ]);
      expect(screen.getByText("Owed, deducted").query()).toBeNull();
    }
  );

  test("an amount off the net less the fee names the figure, and follows a fee edit", async () => {
    const p = dialog_props();
    const screen = await render(<MarkWiredDialog {...p} />);
    await screen.getByLabelText("Transaction id").fill(TX);
    await screen.getByLabelText("Wire fee").fill("25");
    const amount = screen.getByLabelText("Amount sent");
    await amount.fill("4185");

    press(submit_button(screen).element());
    await expect
      .element(amount)
      .toHaveAccessibleDescription(
        "enter $4,175.00, the net total less the wire fee"
      );

    await screen.getByLabelText("Wire fee").fill("20");
    await expect
      .element(amount)
      .toHaveAccessibleDescription(
        "enter $4,180.00, the net total less the wire fee"
      );
    await screen.getByLabelText("Wire fee").fill("15");
    await expect.element(amount).toHaveAttribute("aria-invalid", "false");
    expect(p.on_submit).not.toHaveBeenCalled();
  });

  test("the transaction id, the amount and the date are required; the fee takes no minus", async () => {
    const p = dialog_props();
    const screen = await render(<MarkWiredDialog {...p} />);
    const fee = screen.getByLabelText("Wire fee");
    await fee.fill("-25");
    await expect.element(fee).toHaveValue("0.00");

    press(submit_button(screen).element());
    await expect
      .element(screen.getByLabelText("Transaction id"))
      .toHaveAccessibleDescription("required");
    await expect
      .element(screen.getByLabelText("Amount sent"))
      .toHaveAccessibleDescription("required");

    await screen.getByLabelText("Transaction id").fill(TX);
    await screen.getByLabelText("Amount sent").fill("4200");
    // the date input reports a change only once every segment is cleared, and
    // a segment takes a Backspace per typed digit
    for (const segment of screen.getByRole("spinbutton").all()) {
      await segment.click();
      await userEvent.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    }
    press(submit_button(screen).element());
    await expect
      .element(screen.getByText("required", { exact: true }))
      .toBeVisible();
    expect(p.on_submit).not.toHaveBeenCalled();
  });

  test("with several providers none is chosen for you", async () => {
    const p = dialog_props({ providers: ["Mercury", "Wise"] });
    const screen = await render(<MarkWiredDialog {...p} />);
    await screen.getByLabelText("Transaction id").fill(TX);
    await screen.getByLabelText("Amount sent").fill("4200");
    press(submit_button(screen).element());
    await expect
      .element(screen.getByRole("combobox", { name: "Provider" }))
      .toHaveAccessibleDescription("required");
    expect(p.on_submit).not.toHaveBeenCalled();
  });

  test("a valid wire is sent once, as typed", async () => {
    // the default date is today's: pinned, so a run across midnight can't differ
    vi.setSystemTime(new Date(2026, 10, 18, 12));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const p = dialog_props();
    const screen = await render(<MarkWiredDialog {...p} />);
    await screen.getByLabelText("Wire fee").fill("25");
    await screen.getByLabelText("Transaction id").fill(TX);
    await screen.getByLabelText("Amount sent").fill("4175");

    const submit = submit_button(screen).element();
    press(submit);
    press(submit);
    await vi.waitFor(() =>
      expect(p.on_submit).toHaveBeenCalledWith({
        wire_date: "2026-11-18",
        wire_fee: 25,
        provider: "Mercury",
        provider_tx_id: TX,
        amount_sent: 4175,
        payout_ids: row.payouts.map((p) => p.id),
      })
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(p.on_submit).toHaveBeenCalledOnce();
  });

  test("submitting holds both buttons", async () => {
    const p = dialog_props({ submitting: true });
    const screen = await render(<MarkWiredDialog {...p} />);
    const busy = screen.getByRole("button", { name: "Marking wired…" });
    await expect.element(busy).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("button", { name: "Cancel" }))
      .toHaveAttribute("aria-disabled", "true");
    press(screen.getByRole("button", { name: "Cancel" }).element());
    expect(p.on_close).not.toHaveBeenCalled();
  });

  test("a refusal shows at the submit, the id wrapping, and the dialog stays open", async () => {
    const error = `Transaction ${TX} from Mercury is already recorded. Check the id with the provider.`;
    const screen = await render(
      <MarkWiredDialog {...dialog_props({ error })} />
    );
    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent(error);
    await expect
      .element(submit_button(screen))
      .toHaveAccessibleDescription(error);
    const line = alert.element().firstElementChild as HTMLElement;
    expect(getComputedStyle(line).overflowWrap).toBe("anywhere");
    await expect
      .element(screen.getByRole("dialog", { name: "Mark wired", exact: true }))
      .toBeVisible();
  });

  test("payouts changed while open: what was typed stays, the figures and the amount check follow the new row", async () => {
    const casa: IManualWireRow = {
      npo_id: 1184407,
      name: "Casa Esperanza Foundation",
      gross: 500,
      owed: 93.2,
      net: 406.8,
      minimum: 100,
      bank: "EUR account ending in 7731",
      payouts: row.payouts.map((p, i) => ({ ...p, amount: [180, 320][i] })),
    };
    const added = {
      id: "c2e8c0de-0000-4000-8000-000000009f40",
      label: "tomas.wirth@outlook.com",
      ref: "c2e8...9f40",
      date: "2026-11-20T12:00:00.000Z",
      amount: 120,
    };
    const changed: IManualWireRow = {
      ...casa,
      gross: 620,
      net: 526.8,
      payouts: [...casa.payouts, added],
    };
    const refusal =
      "The payouts changed while this was open, so nothing was recorded. Check the updated amounts and mark it wired again.";
    const p = dialog_props({ row: casa });
    const screen = await render(<MarkWiredDialog {...p} />);
    await screen.getByLabelText("Wire fee").fill("10");
    await screen.getByLabelText("Transaction id").fill(TX);
    await screen.getByLabelText("Amount sent").fill("396.80");

    await screen.rerender(
      <MarkWiredDialog {...p} row={changed} error={refusal} />
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent(refusal);
    await expect.element(screen.getByLabelText("Wire fee")).toHaveValue("10");
    await expect
      .element(screen.getByLabelText("Transaction id"))
      .toHaveValue(TX);
    await expect
      .element(screen.getByLabelText("Amount sent"))
      .toHaveValue("396.80");
    const summary = screen.getByLabelText("Summary");
    await expect.element(summary).toMatchTextContent("Pending$620.00");
    await expect.element(summary).toMatchTextContent("Net total$526.80");
    await expect.element(summary).toMatchTextContent("Amount to send$516.80");
    await expect.element(summary).toMatchTextContent("Balance debit$620.00");
    await expect
      .element(screen.getByRole("list", { name: "Payouts settled" }))
      .toMatchTextContent("tomas.wirth@outlook.comc2e8...9f40");

    press(submit_button(screen).element());
    await expect
      .element(screen.getByLabelText("Amount sent"))
      .toHaveAccessibleDescription(
        "enter $516.80, the net total less the wire fee"
      );
    expect(p.on_submit).not.toHaveBeenCalled();

    await screen.getByLabelText("Amount sent").fill("516.80");
    press(submit_button(screen).element());
    await vi.waitFor(() => expect(p.on_submit).toHaveBeenCalledOnce());
    expect(p.on_submit).toHaveBeenCalledWith(
      expect.objectContaining({
        wire_fee: 10,
        amount_sent: 516.8,
        payout_ids: changed.payouts.map((x) => x.id),
      })
    );
  });

  test("the nonprofit reads on one line at 1440, its id on a second line at 375", async () => {
    onTestFinished(reset_viewport);
    await page.viewport(1440, 900);
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    const identity = () =>
      screen.getByText("Nonprofit", { exact: true }).element()
        .nextElementSibling as HTMLElement;
    const id_line = () => identity().lastElementChild as HTMLElement;

    await vi.waitFor(() =>
      expect(identity().innerText).toBe("SXM Paws · 1293826")
    );
    expect(getComputedStyle(id_line()).display).toBe("inline");

    await page.viewport(375, 812);
    await vi.waitFor(() =>
      expect(identity().innerText).toBe("SXM Paws\nID 1293826")
    );
    expect(getComputedStyle(id_line()).display).toBe("block");
    expect(
      Number.parseFloat(getComputedStyle(id_line()).fontSize)
    ).toBeLessThan(Number.parseFloat(getComputedStyle(identity()).fontSize));
  });

  const date_of = () =>
    [...document.querySelectorAll('[role="dialog"] [role="spinbutton"]')]
      .slice(0, 3)
      .map((e) => e.textContent)
      .join("/");

  test("typing the first character in the Transaction id leaves focus in it and the date as it was", async () => {
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    const date = date_of();
    await screen.getByLabelText("Transaction id").click();
    await userEvent.keyboard("Q");
    // two animation frames and a little more: whatever a keystroke sets in
    // motion has had its turn
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    await new Promise((r) => setTimeout(r, 200));
    await expect.element(screen.getByLabelText("Transaction id")).toHaveFocus();
    await expect
      .element(screen.getByLabelText("Transaction id"))
      .toHaveValue("Q");
    expect(date_of()).toBe(date);
  });

  test("the focus trap's target is where focus is, else where it last was in the dialog (even if that element was replaced), else the month", async () => {
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    const none = { el: null, key: null };
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const month = screen.getByRole("spinbutton").first().element();
    const tx = screen.getByLabelText("Transaction id").element() as HTMLElement;
    // the trap has just put focus on the month: that is where focus is
    expect(initial_focus(dialog, none)).toBe(month);
    await screen.getByLabelText("Transaction id").click();
    expect(initial_focus(dialog, none)).toBe(tx);
    // focus nowhere (read before the dialog puts it back): the last field,
    // as an element or, if its element was replaced, found again by its name
    (document.activeElement as HTMLElement).blur();
    expect(
      initial_focus(dialog, { el: tx, key: '[name="provider_tx_id"]' })
    ).toBe(tx);
    expect(
      initial_focus(dialog, { el: null, key: '[name="provider_tx_id"]' })
    ).toBe(tx);
    // nothing remembered: the month
    expect(initial_focus(dialog, none)).toBe(month);
  });

  test("a field that blurs for a moment gets focus back: the trap never sends it to the date", async () => {
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    const date = date_of();
    await screen.getByLabelText("Transaction id").click();
    (document.activeElement as HTMLElement).blur();
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    await new Promise((r) => setTimeout(r, 100));
    await expect.element(screen.getByLabelText("Transaction id")).toHaveFocus();
    expect(date_of()).toBe(date);
  });
});
