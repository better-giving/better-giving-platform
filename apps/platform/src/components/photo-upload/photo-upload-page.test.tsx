import { MemoryRouter } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  type IPhotoUploadPage,
  PhotoUploadPage,
  type PhotoView,
} from "./photo-upload-page";

const CAMPAIGN = "Clean Water for Kisumu Schools";
const TOO_LARGE = "Photos can be up to 4 MB. Choose a smaller one.";

/** DappLogo is a Link, so the page needs a router around it; a plain
 * MemoryRouter, so a rerender updates the page instead of remounting it */
function page(props: IPhotoUploadPage) {
  return (
    <MemoryRouter>
      <PhotoUploadPage {...props} />
    </MemoryRouter>
  );
}

function photo_input() {
  return document.querySelector<HTMLInputElement>('input[name="photo"]')!;
}

function jpeg(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

function drag(area: Element, type: "dragover" | "drop", files: File[]) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const e = new DragEvent(type, {
    dataTransfer: dt,
    bubbles: true,
    cancelable: true,
  });
  area.dispatchEvent(e);
  return e;
}

/** the route's own pick hold, shaped as it runs on a real input */
function hold_all(input: HTMLInputElement) {
  input.setCustomValidity(TOO_LARGE);
}

describe("photo upload drop area", () => {
  test("a drag over the area is accepted, and a multi-file drop keeps only the first file", async () => {
    const on_pick = vi.fn();
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN }, on_pick })
    );

    const input = screen
      .getByLabelText(/drag a photo here/i)
      .element() as HTMLInputElement;
    const area = input.closest("label") as HTMLLabelElement;

    const first = jpeg("well-opening.jpg");
    const second = jpeg("ribbon-cutting.jpg");
    expect(drag(area, "dragover", [first, second]).defaultPrevented).toBe(true);
    drag(area, "drop", [first, second]);

    expect(on_pick).toHaveBeenCalledTimes(1);
    expect(on_pick).toHaveBeenCalledWith(input);
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe("well-opening.jpg");
    await expect
      .element(screen.getByText("well-opening.jpg", { exact: true }))
      .toBeVisible();
  });

  test("a pick the route holds as too large shows why, on the field", async () => {
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN }, on_pick: hold_all })
    );
    const input = photo_input();
    drag(input.closest("label")!, "drop", [jpeg("phone-photo.jpg")]);

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(TOO_LARGE);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(
      screen.getByRole("alert").element().id
    );
  });

  test("a new pick clears the server's refusal", async () => {
    const refusal = "That file isn't a JPEG, PNG or WebP image.";
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN, error: refusal } })
    );
    const input = photo_input();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(refusal);

    drag(input.closest("label")!, "drop", [jpeg("well-opening.jpg")]);

    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("photo upload, scripted", () => {
  test("the same input holds the pick through uploading and a failed upload, and focus lands on the failure", async () => {
    const ready: PhotoView = { state: "ready", campaign: CAMPAIGN };
    const screen = await render(page({ view: ready }));
    const input = photo_input();
    drag(input.closest("label")!, "drop", [jpeg("well-opening.jpg")]);
    const status = screen.getByRole("status").element();
    expect(status.textContent).toBe("");

    await screen.rerender(
      page({
        view: {
          state: "uploading",
          campaign: CAMPAIGN,
          file_name: "well-opening.jpg",
          preview_url: "",
          loaded: 1,
          total: 2,
        },
      })
    );
    expect(photo_input()).toBe(input);
    expect(input.closest("form")?.getAttribute("aria-busy")).toBe("true");
    const held = screen.getByRole("button", { name: "Uploading…" }).element();
    expect(held.getAttribute("aria-disabled")).toBe("true");
    expect(held.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("status").element()).toBe(status);
    expect(status.textContent).toBe("Uploading well-opening.jpg");

    await screen.rerender(
      page({ view: { state: "failed", campaign: CAMPAIGN } })
    );
    expect(photo_input()).toBe(input);
    expect(input.files?.[0]?.name).toBe("well-opening.jpg");
    expect(status.textContent).toBe("The photo couldn't be saved");
    const band = input.form?.querySelector('[tabindex="-1"]');
    expect(band?.textContent).toContain("Nothing changed");
    expect(document.activeElement).toBe(band);
  });

  test("an upload whose save couldn't be confirmed says so, sends back to the link, and offers no retry", async () => {
    const screen = await render(
      page({
        view: {
          state: "uploading",
          campaign: CAMPAIGN,
          file_name: "well-opening.jpg",
          preview_url: "",
          loaded: 2,
          total: 2,
        },
      })
    );
    const status = screen.getByRole("status").element();

    await screen.rerender(
      page({ view: { state: "unknown", campaign: CAMPAIGN } })
    );
    expect(screen.getByRole("status").element()).toBe(status);
    expect(status.textContent).toBe(
      "We couldn't confirm your photo saved. Open this link again to check; if it's been used up, ask for a new one."
    );
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("We couldn't confirm your photo saved.");
    await expect
      .element(
        screen.getByText(
          "Open this link again to check; if it's been used up, ask for a new one.",
          { exact: true }
        )
      )
      .toBeVisible();
    expect(document.querySelector("form")).toBeNull();
  });

  test("a press while uploading does not submit again", async () => {
    const on_submit = vi.fn((e: { preventDefault(): void }) =>
      e.preventDefault()
    );
    await render(
      page({
        view: {
          state: "uploading",
          campaign: CAMPAIGN,
          file_name: "well-opening.jpg",
          preview_url: "",
          loaded: 1,
          total: 2,
        },
        on_submit,
      })
    );
    const form = photo_input().form!;
    const submitted = new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(submitted);
    expect(on_submit).not.toHaveBeenCalled();
    expect(submitted.defaultPrevented).toBe(true);
  });
});
