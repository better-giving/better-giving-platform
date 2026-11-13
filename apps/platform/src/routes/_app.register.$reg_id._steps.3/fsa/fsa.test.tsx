import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("#/helpers/upload-file", () => ({
  uploadFile: vi.fn(),
  upload_document: vi.fn(),
}));

import { createRoutesStub } from "react-router";
import { FsaForm } from "./index";

async function render_form() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <FsaForm />,
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("FsaForm focus-on-error", () => {
  it("submits empty → focuses first invalid FileDropzone (proof of identity)", async () => {
    const screen = await render_form();

    // fill the text fields ABOVE proof_of_reg so the only remaining errors
    // are the two FileDropzones — verifies the FIRST invalid field (poi)
    // wins focus regardless of fields below it.
    await screen.getByLabelText(/registration number/i).fill("REG-12345");

    await screen.getByRole("button", { name: /sign/i }).click();

    // focus-on-error lands on the drop area, the part that is role=button and
    // carries the name derived from the visible label — the root announces
    // nothing, and the hidden input is aria-hidden by zag's own design.
    await vi.waitFor(() => {
      const active = document.activeElement;
      const dropzone = screen.container.querySelectorAll(
        "[data-scope='file-upload'][data-part='dropzone']"
      )[0];
      expect(active).toBe(dropzone);
      expect(active?.getAttribute("aria-label")).toBe("Government issued ID");
    });
  });
});
