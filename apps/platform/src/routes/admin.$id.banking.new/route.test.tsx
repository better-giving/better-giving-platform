import { AskHost } from "@better-giving/ui";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// --- mocks (hoisted) ---

// the action rejects at its schema, so nothing here ever reaches a query — the
// proxy exists to keep the real neon client out of the bundle
vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("no query is expected on this path");
      },
    }
  ),
}));

vi.mock("$/kit/queue", () => ({
  receiver: {},
  client: {},
  enqueue: vi.fn(async () => {}),
  don_dist: vi.fn(),
  verify_qstash: vi.fn(),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: true,
    user_ctx: true,
  })
);

// the page hands `BankDetails` an `onSubmit` and owns no error surface of its
// own — the wiring under test is what the page does with the result, so the
// form itself stands in as a button that fires the callback.
const bank_statement = vi.hoisted(() => ({
  url: "https://example.com/bank.pdf",
}));

vi.mock("#/components/bank-details", () => ({
  BankDetails: ({ onSubmit, is_loading }: any) => (
    <button
      type="button"
      disabled={is_loading}
      onClick={() =>
        onSubmit(
          { id: 999, currency: "usd", details: { accountNumber: "12345678" } },
          bank_statement.url
        )
      }
    >
      submit bank details
    </button>
  ),
}));

// --- imports (after mocks hoisted) ---

import { action } from "./api";
import AdminBanking from "./route";

beforeEach(async () => {
  await cleanup();
  bank_statement.url = "https://example.com/bank.pdf";
});

describe("admin: new payout method", () => {
  it("surfaces the failure when the action rejects the submission", async () => {
    // a bank statement url the action's schema rejects
    bank_statement.url = "not-a-url";
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/banking/new",
        // the failure prompt is raised through `ask`, which mounts at `AskHost`
        Component: () => (
          <>
            <AdminBanking />
            <AskHost />
          </>
        ),
        HydrateFallback: () => null,
        action: action as any,
      },
      { path: "/admin/:id/banking", Component: () => <p>banking</p> },
    ]);
    const screen = await render(
      <Stub initialEntries={["/admin/1/banking/new"]} />
    );

    await screen.getByRole("button", { name: /submit bank details/i }).click();

    await expect
      .element(screen.getByText(/received "not-a-url"/i))
      .toBeInTheDocument();
  }, 30_000);

  it("draws its one group as a plain section, not a card", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/banking/new",
        Component: AdminBanking,
        HydrateFallback: () => null,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/admin/1/banking/new"]} />
    );

    const region = screen
      .getByRole("region", { name: "Bank account details" })
      .element();
    expect(region.className).not.toMatch(/\bcard\b/);
    await expect
      .element(
        screen.getByRole("heading", { name: "Bank account details", level: 2 })
      )
      .toBeVisible();
  });
});
