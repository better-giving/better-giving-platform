import { AskHost } from "@better-giving/ui";
import { HttpResponse, http } from "msw";
import { createRoutesStub } from "react-router";
import { SWRConfig } from "swr";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { mswWorker } from "#/setup-tests-browser";
import { BankDetails } from "./bank-details";

const FAILED = "Couldn't load currencies. Refresh to try again.";

/** the recipient form below the currency fires its own wise requests */
const recipient_answers = () =>
  mswWorker.use(
    http.post("/api/wise/v3/profiles/:profile/quotes", () =>
      HttpResponse.json({ id: "quote-1" })
    ),
    http.get("/api/wise/v1/quotes/:quote/account-requirements", () =>
      HttpResponse.json([])
    )
  );

/** a fresh swr cache per render: the currencies key is the same in every test */
async function render_details() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <SWRConfig value={{ provider: () => new Map() }}>
          <BankDetails
            FormButtons={() => null}
            onSubmit={async () => {}}
            is_loading={false}
          />
          <AskHost />
        </SWRConfig>
      ),
    },
  ]);
  return render(<Stub />);
}

describe("BankDetails: currency list", () => {
  test("a failed currencies request says why under the disabled field", async () => {
    recipient_answers();
    mswWorker.use(
      http.get("/api/wise/v1/currencies", () =>
        HttpResponse.json({ message: "upstream down" }, { status: 502 })
      )
    );
    const screen = await render_details();
    const field = screen.getByRole("combobox", {
      name: "Select your bank account currency:",
    });

    await expect
      .element(screen.getByText(FAILED, { exact: true }))
      .toBeVisible();
    await expect.element(field).toBeDisabled();
    // the list failed, not the value: the field is not marked invalid
    await expect.element(field).not.toHaveAttribute("aria-invalid", "true");
    await expect.element(screen.getByRole("status")).toHaveTextContent(FAILED);
  });

  test("a loaded list leaves the field usable with no error line", async () => {
    recipient_answers();
    mswWorker.use(
      http.get("/api/wise/v1/currencies", () =>
        HttpResponse.json([
          { code: "USD", name: "United States Dollar" },
          { code: "GBP", name: "British Pound" },
        ])
      )
    );
    const screen = await render_details();
    const field = screen.getByRole("combobox", {
      name: "Select your bank account currency:",
    });

    await expect.element(field).toBeEnabled();
    const hint = "The details Wise asks for next depend on this currency.";
    await expect.element(screen.getByText(hint)).toBeVisible();
    await expect.element(field).toHaveAccessibleDescription(hint);
    await field.click();
    await expect
      .element(screen.getByRole("option", { name: /GBP - British Pound/ }))
      .toBeVisible();
    expect(screen.getByText(FAILED, { exact: true }).query()).toBeNull();
    // the live region is already mounted, so a later failure is announced
    await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
