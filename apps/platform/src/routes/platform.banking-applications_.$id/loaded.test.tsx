import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";
import { Loaded } from "./loaded";

const data = (o: Partial<LoaderData>): LoaderData => ({
  ba: {
    id: "40001",
    npo_id: 7,
    bank_summary: "Chase ****4821",
    bank_statement_url: "https://example.com/s.pdf",
    date_created: "2026-11-10T00:00:00.000Z",
    updated_at: "2026-11-11T00:00:00.000Z",
    status: "under-review",
    rejection_reason: "",
  },
  id: 40001,
  currency: "USD",
  country: "US",
  wacc_unavailable: false,
  npo_name: "Riverbend Youth Coding Collective",
  account_holder: "Harbor Light Food Pantry Inc.",
  legal_name: "Harbor Light Food Pantry Inc.",
  holder_match: "match",
  own_account: false,
  ...o,
});

const render_page = (d: LoaderData) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Loaded {...d} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

const MISMATCH_TITLE = "The account holder doesn't match the legal name";

describe("banking application review — account holder", () => {
  test("a matching holder gets the match badge and no callout", async () => {
    const screen = await render_page(data({}));
    await expect
      .element(screen.getByText("Matches legal name", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Nonprofit legal name", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Recipient name").query()).toBeNull();
    expect(screen.getByRole("region").query()).toBeNull();
  });

  test("a mismatched holder gets the warning badge and the callout naming both", async () => {
    const screen = await render_page(
      data({
        account_holder: "Dana Whitfield",
        legal_name: "Riverbend Youth Coding Collective Inc.",
        holder_match: "mismatch",
      })
    );
    await expect
      .element(screen.getByText("Doesn't match", { exact: true }))
      .toBeVisible();
    const callout = screen.getByRole("region", { name: MISMATCH_TITLE });
    await expect.element(callout).toBeVisible();
    await expect
      .element(
        screen.getByText(
          "This account is held by Dana Whitfield. The nonprofit's legal name is Riverbend Youth Coding Collective Inc. Approving sends its payouts to an account held by someone else, so confirm with the nonprofit first."
        )
      )
      .toBeVisible();
    // Approve stays open: the confirmation lives in the prompt
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "false");
  });

  test("an unknown holder gets no badge", async () => {
    const screen = await render_page(
      data({ account_holder: null, holder_match: "unknown" })
    );
    await expect
      .element(screen.getByText("Account holder", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Matches legal name").query()).toBeNull();
    expect(screen.getByText("Doesn't match").query()).toBeNull();
  });

  test("Better Giving's own account is called out and can't be approved", async () => {
    const screen = await render_page(data({ own_account: true }));
    await expect
      .element(
        screen.getByRole("region", {
          name: "This is Better Giving's own bank account",
        })
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Approve" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  test("no holder rows while wise is unreachable", async () => {
    const screen = await render_page(data({ wacc_unavailable: true }));
    await expect
      .element(screen.getByText("Bank statement", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Account holder").query()).toBeNull();
  });
});
