import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PhotoUploadPage } from "./photo-upload-page";

describe("photo upload drop area", () => {
  test("a dropped file lands in the input and reaches on_pick", async () => {
    const on_pick = vi.fn();
    // DappLogo is a Link, so the page needs a router around it
    const Stub = createRoutesStub([
      {
        path: "/photo-upload/:token",
        Component: () => (
          <PhotoUploadPage
            view={{
              state: "ready",
              campaign: "Clean Water for Kisumu Schools",
            }}
            on_pick={on_pick}
          />
        ),
      },
    ]);
    const screen = await render(<Stub initialEntries={["/photo-upload/t"]} />);

    const input = screen
      .getByLabelText(/drag a photo here/i)
      .element() as HTMLInputElement;
    const area = input.closest("label") as HTMLLabelElement;

    const file = new File(["x"], "well-opening.jpg", { type: "image/jpeg" });
    const dt = new DataTransfer();
    dt.items.add(file);
    area.dispatchEvent(
      new DragEvent("dragover", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      })
    );
    area.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      })
    );

    expect(on_pick).toHaveBeenCalledTimes(1);
    expect(on_pick).toHaveBeenCalledWith(input);
    expect(input.files?.[0]?.name).toBe("well-opening.jpg");
    await expect
      .element(screen.getByText("well-opening.jpg", { exact: true }))
      .toBeVisible();
  });
});
