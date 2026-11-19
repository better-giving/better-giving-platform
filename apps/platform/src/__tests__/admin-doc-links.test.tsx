import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import ApplicationReview from "#/routes/platform.applications_.$id/loaded";
import { Loaded as BankingApplication } from "#/routes/platform.banking-applications_.$id/loaded";

// the route module re-exports its loader and action from the server-only api
vi.mock("#/routes/admin.$id.banking.$bank_id/api", () => ({
  default_action: vi.fn(),
  loader: vi.fn(),
}));

import AdminBankDetail from "#/routes/admin.$id.banking.$bank_id/route";

/** what a record stores for an uploaded document, and the link a reviewer must
 * get for it: through `/api/docs`, never the private url itself (which opens
 * nothing without the store's token) */
const stored = (name: string) =>
  `https://store1.private.blob.vercel-storage.com/docs/u1/${name}`;
const through_docs = (name: string) =>
  `/api/docs?ref=https%3A%2F%2Fstore1.private.blob.vercel-storage.com%2Fdocs%2Fu1%2F${name}`;

const FSA = "https://sign.example.com/envelopes/abc/signed.pdf";

const link_to = (screen: Awaited<ReturnType<typeof render>>, name: RegExp) =>
  screen.getByRole("link", { name });

const href_of = (l: ReturnType<typeof link_to>) =>
  (l.element() as HTMLAnchorElement).getAttribute("href");

const mount = (Component: () => React.ReactNode) => {
  const Stub = createRoutesStub([
    { path: "/", Component, HydrateFallback: () => null },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("admin document links", () => {
  test("the application review opens each uploaded document through /api/docs, and the signing provider's file directly", async () => {
    const props = {
      id: "reg-1",
      status: "02",
      updated_at: "2026-01-01T00:00:00Z",
      o_type: "501c3",
      o_ein: "12-3456789",
      r_first_name: "Jane",
      r_last_name: "Doe",
      r_id: "jane@example.com",
      r_proof_of_identity: stored("id-aaa.pdf"),
      o_proof_of_reg: stored("reg-bbb.pdf"),
      o_fsa_signed_doc_url: FSA,
      o_bank_statement: stored("bank-ccc.pdf"),
      bank: {
        displayFields: [{ key: "accountNumber", label: "Account", value: "1" }],
      },
      bank_unavailable: false,
      approvable: true,
    };
    const screen = await mount(() => <ApplicationReview {...(props as any)} />);

    expect(href_of(link_to(screen, /id-aaa/))).toBe(through_docs("id-aaa.pdf"));
    expect(href_of(link_to(screen, /reg-bbb/))).toBe(
      through_docs("reg-bbb.pdf")
    );
    expect(href_of(link_to(screen, /bank-ccc/))).toBe(
      through_docs("bank-ccc.pdf")
    );
    // not a stored document: `/api/docs` would refuse it, so its own link is used
    expect(href_of(link_to(screen, /signed\.pdf/))).toBe(FSA);
  });

  test("the application review still links the bank statement when the payout provider is down", async () => {
    const props = {
      id: "reg-1",
      status: "02",
      updated_at: "2026-01-01T00:00:00Z",
      o_type: "501c3",
      r_first_name: "Jane",
      r_last_name: "Doe",
      o_bank_statement: stored("bank-ccc.pdf"),
      bank: null,
      bank_unavailable: true,
      approvable: false,
    };
    const screen = await mount(() => <ApplicationReview {...(props as any)} />);
    expect(href_of(link_to(screen, /bank-ccc/))).toBe(
      through_docs("bank-ccc.pdf")
    );
  });

  test("the banking application review opens the statement through /api/docs", async () => {
    const props = {
      id: 123,
      wacc_unavailable: true,
      ba: {
        status: "under-review",
        date_created: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        bank_statement_url: stored("bank-ddd.pdf"),
      },
    };
    const screen = await mount(() => (
      <BankingApplication {...(props as any)} />
    ));
    expect(href_of(link_to(screen, /bank-ddd/))).toBe(
      through_docs("bank-ddd.pdf")
    );
  });

  test("the nonprofit's banking detail opens the statement through /api/docs", async () => {
    const loaderData = {
      wacc_unavailable: true,
      ba: {
        status: "approved",
        bank_summary: "Bank ***1234",
        bank_statement_url: stored("bank-eee.pdf"),
      },
    };
    const screen = await mount(() => (
      <AdminBankDetail {...({ loaderData, params: { id: "7" } } as any)} />
    ));
    expect(href_of(link_to(screen, /bank-eee/))).toBe(
      through_docs("bank-eee.pdf")
    );
  });
});
