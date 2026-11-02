import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QrCode } from "./qr-code";

describe("qr code centre logo", () => {
  it("falls back to the building icon when the org's logo fails to load", async () => {
    const screen = await render(
      <QrCode
        logo="data:image/png;base64,iVBORw0KGgo="
        profile_url="https://example.com/org/1"
        donate_url="https://example.com/donate/1"
      />
    );
    await vi.waitFor(() => {
      const img =
        screen.container.querySelector<HTMLImageElement>("img[width='48']");
      expect(img?.getAttribute("src")).toMatch(/org-building/);
    });
  });
});
