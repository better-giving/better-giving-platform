import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, test } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import ErrorPage from "./error-page";
import type { ErrorQueryParams } from "./types";

const base: ErrorQueryParams = {
  action: "signerError",
  signerStatus: "sent",
  errorType: "unknown",
  signerEid: "signer-1",
  documentGroupStatus: "sent",
  documentGroupEid: "group-1",
  etchPacketEid: "packet-1",
  error: "",
  message: "",
};

async function render_page(p: Partial<ErrorQueryParams>) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <ErrorPage {...base} {...p} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

beforeEach(async () => {
  await cleanup();
});

describe("the signing error's detail box", () => {
  test.each([
    ["both empty", {}],
    ["both absent", { error: undefined, message: undefined }],
  ])("is not drawn when the redirect carries no detail (%s)", async (_, p) => {
    const screen = await render_page(p as Partial<ErrorQueryParams>);
    await expect
      .element(screen.getByRole("heading", { name: "Signing failed" }))
      .toBeVisible();
    // the box is the only paragraph; the cases below prove it is live
    expect(screen.container.querySelector("p")).toBeNull();
  });

  test.each([
    ["only an error", { error: "Token expired" }, "Token expired"],
    ["only a message", { message: "Request a new link" }, "Request a new link"],
    [
      "both",
      { error: "Token expired", message: "Request a new link" },
      "Token expired: Request a new link",
    ],
  ])(
    "joins what it has with a colon only between two parts (%s)",
    async (_, p, text) => {
      const screen = await render_page(p);
      await expect
        .element(screen.getByText(text, { exact: true }))
        .toBeVisible();
    }
  );
});
