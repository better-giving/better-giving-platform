import { MemoryRouter } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  photo_link_ttl_ms,
  photo_types,
  photo_upload_quota,
  photo_wrong_type,
} from "@/constants/upload";
import {
  format_duration,
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

/** the route's type hold: anything but a JPEG, PNG or WebP is held */
function hold_type(input: HTMLInputElement) {
  const type = input.files?.[0]?.type ?? "";
  input.setCustomValidity(
    (photo_types as readonly string[]).includes(type) ? "" : photo_wrong_type
  );
}

const UPLOADING: PhotoView = {
  state: "uploading",
  campaign: CAMPAIGN,
  file_name: "well-opening.jpg",
  preview_url: "",
  loaded: 1,
  total: 2,
};

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

  test.each([
    ["annual-report.pdf", "application/pdf"],
    ["IMG_0412.heic", "image/heic"],
  ])(
    "a dropped %s is held before it uploads, and a photo dropped after clears the hold",
    async (name, type) => {
      const on_pick = vi.fn(hold_type);
      const screen = await render(
        page({ view: { state: "ready", campaign: CAMPAIGN }, on_pick })
      );
      const input = photo_input();
      const area = input.closest("label")!;
      drag(area, "drop", [new File(["x"], name, { type })]);

      expect(on_pick).toHaveBeenCalledWith(input);
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent(photo_wrong_type);
      expect(input.form?.checkValidity()).toBe(false);

      drag(area, "drop", [jpeg("well-opening.jpg")]);
      await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    }
  );

  test("a drop that misses the area stays on the page while the form is up, and the guard leaves with the form", async () => {
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN } })
    );
    const file = [jpeg("well-opening.jpg")];
    expect(drag(document.body, "dragover", file).defaultPrevented).toBe(true);
    expect(drag(document.body, "drop", file).defaultPrevented).toBe(true);

    await screen.rerender(
      page({ view: { state: "saved", campaign: CAMPAIGN, photo: "" } })
    );
    expect(drag(document.body, "drop", file).defaultPrevented).toBe(false);
  });

  test("the limits and the link's lifetime show before anything is chosen", async () => {
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN } })
    );
    await expect.element(screen.getByText("Up to 4 MB")).toBeVisible();
    await expect.element(screen.getByText("JPEG, PNG or WebP")).toBeVisible();
    await expect
      .element(
        screen.getByText(
          "It replaces the banner at the top of the campaign page, if there is one.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByText("expires 15 minutes after it was created"))
      .toBeVisible();
    expect(photo_input().accept).toBe("image/jpeg,image/png,image/webp");
  });
});

describe("photo upload durations", () => {
  test("whole minutes read as minutes, anything else as seconds", () => {
    expect(format_duration(60)).toBe("a minute");
    expect(format_duration(120)).toBe("2 minutes");
    expect(format_duration(30)).toBe("30 seconds");
    expect(format_duration(1)).toBe("a second");
    expect(format_duration(90)).toBe("90 seconds");
    expect(format_duration(photo_link_ttl_ms / 1000)).toBe("15 minutes");
    expect(format_duration(photo_upload_quota.window_s)).toBe("a minute");
  });

  test("a spent or rate-limited link names its window", async () => {
    const screen = await render(page({ view: { state: "limited" } }));
    await expect
      .element(screen.getByText("Wait a minute, then try again."))
      .toBeVisible();
    await screen.rerender(page({ view: { state: "gone" } }));
    await expect
      .element(screen.getByText("expire after 15 minutes."))
      .toBeVisible();
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

    await screen.rerender(page({ view: UPLOADING }));
    expect(photo_input()).toBe(input);
    expect(input.closest("form")?.hasAttribute("aria-busy")).toBe(false);
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
    // the focused band is the announcement; the region stays quiet
    expect(status.textContent).toBe("");
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
      "We couldn't confirm your photo was saved. Open this link again to check; if it's been used up, ask for a new one."
    );
    const heading = screen.getByRole("heading", { level: 1 });
    await expect
      .element(heading)
      .toHaveTextContent("We couldn't confirm your photo was saved");
    await expect.element(heading).toHaveFocus();
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

  test("the bar and button say Saving once every byte is sent", async () => {
    const screen = await render(page({ view: UPLOADING }));
    await expect
      .element(screen.getByRole("button", { name: "Uploading…" }))
      .toBeVisible();

    await screen.rerender(page({ view: { ...UPLOADING, loaded: 2 } }));
    await expect
      .element(screen.getByRole("button", { name: "Saving…" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("progressbar", { name: "Saving photo" }))
      .toHaveAttribute("aria-valuenow", "100");
  });

  test("a save that replaces the form takes focus to its heading", async () => {
    const screen = await render(
      page({ view: { state: "ready", campaign: CAMPAIGN } })
    );
    await screen.getByRole("button", { name: "Upload photo" }).click();
    await screen.rerender(page({ view: UPLOADING }));
    await screen.rerender(
      page({ view: { state: "saved", campaign: CAMPAIGN, photo: "" } })
    );

    const heading = screen.getByRole("heading", { name: "Photo added" });
    await expect.element(heading).toHaveFocus();
    await expect
      .element(
        screen.getByText("This link is now used up. You can close this tab.", {
          exact: true,
        })
      )
      .toBeVisible();
  });

  test("a saved page the server renders first leaves focus where it was", async () => {
    const screen = await render(
      page({ view: { state: "saved", campaign: CAMPAIGN, photo: "" } })
    );
    await expect
      .element(screen.getByRole("heading", { name: "Photo added" }))
      .toBeVisible();
    expect(document.activeElement).toBe(document.body);
  });

  test("a press while uploading does not submit again", async () => {
    const on_submit = vi.fn((e: { preventDefault(): void }) =>
      e.preventDefault()
    );
    await render(page({ view: UPLOADING, on_submit }));
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
