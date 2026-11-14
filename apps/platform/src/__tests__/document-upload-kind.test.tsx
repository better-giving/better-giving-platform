import { HttpResponse, http } from "msw";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { RecipientDetailsForm } from "#/components/bank-details/recipient-details/recipient-details-form";
import { FsaForm } from "#/routes/_app.register.$reg_id._steps.3/fsa";
import { mswWorker } from "#/setup-tests-browser";

/** the dropzone call sites run the real `uploadFile`; what reaches the
 * server is what these tests read, so a site wired to the wrong kind goes red */
const record_uploads = () => {
  const kinds: (string | null)[] = [];
  mswWorker.use(
    http.post("/api/file-upload", ({ request }) => {
      kinds.push(new URL(request.url).searchParams.get("kind"));
      return HttpResponse.json({ url: "https://private.example/docs/u/x.pdf" });
    })
  );
  return kinds;
};

/** hands `statement.pdf` to the `n`th dropzone's file input */
const pick_pdf = (container: HTMLElement, n: number) => {
  const input =
    container.querySelectorAll<HTMLInputElement>("input[type='file']")[n]!;
  const dt = new DataTransfer();
  dt.items.add(
    new File(["%PDF"], "statement.pdf", { type: "application/pdf" })
  );
  Object.defineProperty(input, "files", {
    value: dt.files,
    configurable: true,
  });
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("document dropzones upload as documents", () => {
  test("the bank statement dropzone asks for a private document", async () => {
    const kinds = record_uploads();
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <RecipientDetailsForm
            fields={[]}
            currency="GBP"
            amount={0}
            type="sort_code"
            quoteId="quote-1"
            verified
            FormButtons={() => <button type="submit">Continue</button>}
            onSubmit={vi.fn()}
          />
        ),
      },
    ]);
    const screen = await render(<Stub />);

    pick_pdf(screen.container, 0);

    await vi.waitFor(() => expect(kinds).toEqual(["document"]));
  });

  test("the ID and proof of registration dropzones ask for private documents", async () => {
    const kinds = record_uploads();
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <FsaForm />,
        HydrateFallback: () => null,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);

    pick_pdf(screen.container, 0);
    pick_pdf(screen.container, 1);

    await vi.waitFor(() => expect(kinds).toEqual(["document", "document"]));
  });
});
