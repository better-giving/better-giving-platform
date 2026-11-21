import { describe, expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { type IMarkWiredDialog, MarkWiredDialog } from "./mark-wired-dialog";
import type { IManualWireRow } from "./types";

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
      date: "2026-10-01T12:00:00.000Z",
      amount: 1904.1,
    },
    {
      id: "6d20c0de-0000-4000-8000-00000000d165",
      label: "Savings",
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

const submit_button = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("button", { name: "Mark wired", exact: true });

describe("mark wired dialog", () => {
  test("names the nonprofit, preselects the one provider, lists the payouts and sums the wire live from the fee", async () => {
    const screen = await render(<MarkWiredDialog {...dialog_props()} />);
    await expect
      .element(screen.getByRole("dialog", { name: "Mark wired", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("SXM Paws · 1293826")).toBeVisible();
    await expect
      .element(screen.getByRole("combobox", { name: "Provider" }))
      .toMatchTextContent("Mercury");

    const payouts = screen.getByRole("list", { name: "Payouts settled" });
    await expect.element(payouts).toMatchTextContent("f3b1...e8f4");
    await expect.element(payouts).toMatchTextContent("Oct 1, 2026");
    await expect.element(payouts).toMatchTextContent("$2,908.30");

    const summary = screen.getByLabelText("Summary");
    await expect.element(summary).toMatchTextContent("Owed, deducted−$612.40");
    await expect.element(summary).toMatchTextContent("Wire fee−$0.00");
    await expect.element(summary).toMatchTextContent("Amount to send$4,200.00");

    await screen.getByLabelText("Wire fee").fill("25");
    await expect.element(summary).toMatchTextContent("Wire fee−$25.00");
    await expect.element(summary).toMatchTextContent("Amount to send$4,175.00");
    await expect.element(summary).toMatchTextContent("Balance debit$4,812.40");
  });

  test.each([
    // owing: the recovered share leaves the cash with the rest of the gross
    ["$500 pending, $93.20 owed", 500, 93.2, 406.8, "$406.80", "$500.00"],
    ["nothing owed", 4200, 0, 4200, "$4,200.00", "$4,200.00"],
  ])(
    "the balance debit is the gross of the payouts settled: %s",
    async (_, gross, owed, net, net_text, debit_text) => {
      const screen = await render(
        <MarkWiredDialog
          {...dialog_props({ row: { ...row, gross, owed, net } })}
        />
      );
      const summary = screen.getByLabelText("Summary");
      await expect.element(summary).toMatchTextContent(`Net total${net_text}`);
      await expect
        .element(summary)
        .toMatchTextContent(`Balance debit${debit_text}`);
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
});
