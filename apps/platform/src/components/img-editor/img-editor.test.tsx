import { AskHost } from "@better-giving/ui";
import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
// the preview branch hides its controls in css (`sr-only` until hover or a
// keyboard focus inside), and whether they can take focus and then show is the point
// of several cases — so the real stylesheet must be loaded to observe it.
import "#/index.css";
import { ImgEditor } from "./img-editor";
import type { ControlledProps, ImgOutput, ImgSpec } from "./types";

const upload_mock = vi.hoisted(() => vi.fn());
vi.mock("#/helpers/upload-file", () => ({
  uploadFile: upload_mock,
}));

// mock cropper — it requires canvas and stylesheet
vi.mock("./img-cropper", () => ({
  ImgCropper: (props: {
    open: boolean;
    input: File;
    resolve: (f?: File) => void;
    on_closed: () => void;
  }) =>
    props.open ? (
      <div data-testid="mock-cropper">
        <button
          type="button"
          // `on_closed` stands in for the exit-complete a real dialog fires;
          // without it the ask sits mounted until its backstop
          onClick={() => {
            props.resolve(props.input);
            props.on_closed();
          }}
          data-testid="crop-save"
        >
          Save crop
        </button>
        <button
          type="button"
          onClick={() => {
            props.resolve();
            props.on_closed();
          }}
          data-testid="crop-close"
        >
          Close crop
        </button>
      </div>
    ) : null,
}));

const spec: ImgSpec = {
  type: ["image/jpeg", "image/png"],
  aspect: [4, 1] as [number, number],
  max_size: 5e6,
};

function make_props(overrides?: Partial<ControlledProps>): ControlledProps {
  return {
    value: "",
    on_change: vi.fn(),
    on_undo: vi.fn(),
    spec,
    ...overrides,
  };
}

/** the cropper is raised through `ask`, which mounts at `AskHost` — no host in
 *  the tree and `crop_and_upload` waits on a promise nothing can settle. */
const render_editor = (props: ControlledProps) =>
  render(
    <>
      <ImgEditor {...props} />
      <AskHost />
    </>
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImgEditor", () => {
  test("renders upload prompt and valid types when no image", async () => {
    const props = make_props();
    const screen = await render_editor(props);

    await expect.element(screen.getByText(/upload file/i)).toBeVisible();
    await expect
      .element(screen.getByText(/click to browse or drag & drop/i))
      .toBeVisible();
    await expect.element(screen.getByText(/JPEG, PNG/)).toBeVisible();
    await expect.element(screen.getByText(/less than 5MB/)).toBeVisible();
  });

  test("shows aspect ratio tooltip for known ratios", async () => {
    const props = make_props();
    const screen = await render_editor(props);

    // 4:1 aspect shows recommended size
    await expect.element(screen.getByText(/4:1/)).toBeVisible();
  });

  test("rejects invalid file type", async () => {
    const on_change = vi.fn();
    const props = make_props({ on_change });
    const screen = await render_editor(props);

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const bad_file = new File(["data"], "file.svg", {
      type: "image/svg+xml",
    });

    const dt = new DataTransfer();
    dt.items.add(bad_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith("invalid-type")
    );
  });

  test("rejects file exceeding size limit", async () => {
    const on_change = vi.fn();
    const props = make_props({ on_change });
    const screen = await render_editor(props);

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    // 6MB exceeds 5MB limit
    const big_file = new File([new ArrayBuffer(6e6)], "big.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(big_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith("exceeds-size")
    );
  });

  test("valid file opens cropper, save triggers upload", async () => {
    upload_mock.mockResolvedValue("https://cdn.example.com/cropped.png");
    const on_change = vi.fn();
    const props = make_props({ on_change });
    const screen = await render_editor(props);

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const valid_file = new File(["img"], "photo.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(valid_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // cropper should open
    await expect.element(screen.getByTestId("mock-cropper")).toBeVisible();

    // save the crop
    await screen.getByTestId("crop-save").click();

    // should trigger loading then URL
    await vi.waitFor(() => expect(on_change).toHaveBeenCalledWith("loading"));
    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith(
        "https://cdn.example.com/cropped.png"
      )
    );
  });

  test("upload failure calls on_change('failure')", async () => {
    upload_mock.mockRejectedValue(new Error("upload failed"));
    const on_change = vi.fn();
    const props = make_props({ on_change });
    const screen = await render_editor(props);

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const valid_file = new File(["img"], "photo.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(valid_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // save crop to trigger upload
    await expect.element(screen.getByTestId("mock-cropper")).toBeVisible();
    await screen.getByTestId("crop-save").click();

    await vi.waitFor(() => expect(on_change).toHaveBeenCalledWith("failure"));
  });

  test("disabled state prevents interaction", async () => {
    const props = make_props({ disabled: true });
    const screen = await render_editor(props);

    await vi.waitFor(() => {
      const dropzone = screen.container.querySelector('[data-disabled="true"]');
      expect(dropzone).not.toBeNull();
    });
  });

  test("shows error message", async () => {
    const props = make_props({ error: "invalid file type" });
    const screen = await render_editor(props);

    await expect.element(screen.getByText("invalid file type")).toBeVisible();
  });

  // the preview writes `value` straight into an <img src>, so a
  // sentinel reaching that branch requests a relative path that does not exist
  // and hides the upload prompt behind a bare icon control in a state the
  // user never chose. reachable without a local `file`:
  // a value restored from the server, or written back after the file cleared.
  test.each(["loading", "invalid-type", "exceeds-size", "failure"] as const)(
    "the %s sentinel is not rendered as a preview url",
    async (sentinel) => {
      const props = make_props({ value: sentinel });
      const screen = await render_editor(props);

      await vi.waitFor(() => {
        const dropzone =
          screen.container.querySelector<HTMLElement>("[data-drag]");
        expect(dropzone).not.toBeNull();
        expect(dropzone?.querySelector("img")).toBeNull();
      });
      // no preview means the upload prompt, not the bare icon control
      await expect.element(screen.getByText("Upload file")).toBeVisible();
    }
  );

  // a saved logo whose url no longer loads: the dropzone holds the image
  // placeholder rather than an empty box
  test("a preview url that fails to load shows the placeholder", async () => {
    const props = make_props({
      value: "data:image/png;base64,iVBORw0KGgo=",
      classes: { dropzone: "w-48 aspect-square" },
    });
    const screen = await render_editor(props);

    await vi.waitFor(() => {
      const dropzone =
        screen.container.querySelector<HTMLElement>("[data-drag]");
      expect(dropzone?.querySelector("img")).toBeNull();
      expect(dropzone?.querySelector(".lucide-image")).not.toBeNull();
    });
  });
});

/** what the call sites render immediately before the editor. the editor's own
 * root carries no accessible name, so the visible label is the only stable
 * handle on one specific editor. */
const LABEL = "Banner image of your organization";
/** a 1x1 gif: the preview goes into an <img src>, and a http url there is a
 * real unmocked fetch out of the test browser */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** the shape every call site uses: a controller-driven editor whose rule fails,
 * with a text field BELOW it — so a submit exercises RHF's default
 * focus-on-error rather than an explicit `setFocus` */
function RHFHarness(props: {
  initial?: ImgOutput;
  rule?: (v: ImgOutput) => true | string;
  /** makes the field below invalid too, so the two compete for focus */
  text_required?: boolean;
}) {
  const { control, handleSubmit, register } = useForm<{
    image: ImgOutput;
    title: string;
  }>({
    defaultValues: { image: props.initial ?? "", title: "" },
  });
  const { field } = useController({
    control,
    name: "image",
    rules: { validate: props.rule ?? ((v) => !!v || "required") },
  });

  return (
    <form onSubmit={handleSubmit(() => {})}>
      <p>{LABEL}</p>
      <ImgEditor
        ref={field.ref}
        value={field.value}
        on_change={field.onChange}
        on_undo={() => field.onChange("")}
        spec={spec}
      />
      <input
        aria-label="Title"
        {...register("title", {
          required: props.text_required ? "required" : false,
        })}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe("ImgEditor: focus target", () => {
  test("failed submit focuses the file input and scrolls the field into view", async () => {
    const screen = await render(<RHFHarness />);
    const root = screen.getByText(LABEL).element()
      .nextElementSibling as HTMLElement;
    const scroll = vi.spyOn(root, "scrollIntoView");

    await screen.getByRole("button", { name: /submit/i }).click();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        root.querySelector("input[type='file']")
      );
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    });
  });

  test("wins focus over an invalid field below it", async () => {
    const screen = await render(<RHFHarness text_required />);
    const root = screen.getByText(LABEL).element()
      .nextElementSibling as HTMLElement;
    const scroll = vi.spyOn(root, "scrollIntoView");

    await screen.getByRole("button", { name: /submit/i }).click();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        root.querySelector("input[type='file']")
      );
      // focus alone does not move the page; the scroll is the half this case
      // turns on
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    });
    // without a focusable handle RHF skips the image and lands here instead
    expect(document.activeElement).not.toBe(
      screen.getByLabelText("Title").element()
    );
  });

  test("preview branch: the file input takes focus and still scrolls", async () => {
    const screen = await render(
      <RHFHarness initial={PIXEL} rule={() => "rejected"} />
    );
    const root = screen.getByText(LABEL).element()
      .nextElementSibling as HTMLElement;
    const scroll = vi.spyOn(root, "scrollIntoView");

    await screen.getByRole("button", { name: /submit/i }).click();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        root.querySelector("input[type='file']")
      );
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    });
  });

  test("an upload in flight: the dropzone takes focus instead", async () => {
    const screen = await render(
      <RHFHarness initial="loading" rule={() => "rejected"} />
    );
    const root = screen.getByText(LABEL).element()
      .nextElementSibling as HTMLElement;

    await screen.getByRole("button", { name: /submit/i }).click();

    // the input is disabled while loading, so focus() on it is a no-op — the
    // dropzone takes it instead, which paints its own focus ring
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(root.querySelector("[data-drag]"));
    });
  });

  test("the dropzone fallback paints its ring after a mouse submit, until blur", async () => {
    const screen = await render(
      <RHFHarness initial="loading" rule={() => "rejected"} />
    );
    const root = screen.getByText(LABEL).element()
      .nextElementSibling as HTMLElement;
    const dropzone = root.querySelector("[data-drag]") as HTMLElement;

    // a real pointer press: a focus that follows it is not :focus-visible
    await screen.getByRole("button", { name: /submit/i }).click();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(dropzone);
      expect(getComputedStyle(dropzone).outlineStyle).toBe("solid");
    });

    await screen.getByLabelText("Title").click();
    await vi.waitFor(() =>
      expect(getComputedStyle(dropzone).outlineStyle).toBe("none")
    );
  });
});

describe("ImgEditor: preview controls", () => {
  test("Tab reaches the replace input, and its control shows while focused", async () => {
    const screen = await render_editor(make_props({ value: PIXEL }));
    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;
    // the button-styled box the sr-only input sits in is what a sighted
    // keyboard user sees; its row is what is hidden at rest
    const control = input.parentElement as HTMLElement;
    const row = control.parentElement as HTMLElement;

    // pointer users see the bare preview at rest
    expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(1);

    // the aspect tooltip's trigger may sit before it in the tab order
    for (let i = 0; i < 5 && document.activeElement !== input; i++) {
      await userEvent.tab();
    }
    await expect.element(input).toHaveFocus();
    expect(row.getBoundingClientRect().width).toBeGreaterThan(1);
    await expect.element(control).toBeVisible();
  });

  test("a mouse click does not leave the controls painted once the pointer leaves", async () => {
    // a size, as every call site gives it: the preview branch's content is
    // absolute, so the dropzone is otherwise a 0px box nothing can click
    const screen = await render_editor(
      make_props({ value: PIXEL, classes: { dropzone: "w-60 aspect-square" } })
    );
    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;
    // the native picker never opens in a test browser; this stands in for it
    vi.spyOn(input, "click").mockImplementation(() => {});
    const row = (input.parentElement as HTMLElement)
      .parentElement as HTMLElement;
    const dropzone = screen.container.querySelector(
      "[data-drag]"
    ) as HTMLElement;

    await page.elementLocator(dropzone).click();
    // the press focused the dropzone: a reveal keyed off :focus would keep them shown
    expect(document.activeElement).toBe(dropzone);
    await page.elementLocator(dropzone).unhover();

    await vi.waitFor(() =>
      expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(1)
    );
  });

  test("a touch screen shows the controls at rest", async () => {
    // touch emulation, not an emulated media feature, so `(hover: none)`
    // comes from the device the way a phone reports it. it lands a frame or so
    // after the call
    await cdp().send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    try {
      await vi.waitFor(() =>
        expect(matchMedia("(hover: none)").matches).toBe(true)
      );
      const screen = await render_editor(make_props({ value: PIXEL }));
      const input = screen.container.querySelector(
        "input[type='file']"
      ) as HTMLInputElement;
      const control = input.parentElement as HTMLElement;

      expect(
        (control.parentElement as HTMLElement).getBoundingClientRect().width
      ).toBeGreaterThan(1);
      await expect.element(control).toBeVisible();
    } finally {
      await cdp().send("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
    }
  });

  // the dropzone forwards a pointer click to the input
  test("a click on the preview opens the picker", async () => {
    const screen = await render_editor(make_props({ value: PIXEL }));
    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;
    const pick = vi.spyOn(input, "click").mockImplementation(() => {});

    (screen.container.querySelector("[data-drag]") as HTMLElement).click();
    expect(pick).toHaveBeenCalledTimes(1);
  });

  test("the undo and crop buttons are named", async () => {
    upload_mock.mockResolvedValue("https://cdn.example.com/cropped.png");
    const screen = await render_editor(make_props());
    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const dt = new DataTransfer();
    dt.items.add(new File(["img"], "photo.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await screen.getByTestId("crop-save").click();

    await expect
      .element(screen.getByRole("button", { name: "Undo image change" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Crop image" }))
      .toBeInTheDocument();
  });
});

const reject_messages: Partial<Record<ImgOutput, string>> = {
  "invalid-type": "invalid file type",
  "exceeds-size": "exceeds file size limit",
};

/** a caller whose error follows the value, the way every call site's schema
 * turns a picked file's sentinel into a message */
function CaptionedEditor() {
  const [value, set_value] = useState<ImgOutput>("");
  return (
    <>
      <label htmlFor="banner">Banner</label>
      <ImgEditor
        id="banner"
        value={value}
        on_change={set_value}
        on_undo={() => set_value("")}
        spec={spec}
        error={reject_messages[value]}
      />
      <AskHost />
    </>
  );
}

describe("ImgEditor: description", () => {
  test("the types and size hint describes the input before any error", async () => {
    const screen = await render(<CaptionedEditor />);
    const input = screen.getByLabelText("Banner", { exact: true });

    await expect.element(input).toHaveAccessibleDescription(/JPEG, PNG/);
    await expect.element(input).not.toHaveAttribute("aria-invalid", "true");
  });

  test.each([
    {
      case: "wrong type",
      file: new File(["data"], "file.svg", { type: "image/svg+xml" }),
      message: "invalid file type",
    },
    {
      case: "too large",
      file: new File([new ArrayBuffer(6e6)], "big.png", { type: "image/png" }),
      message: "exceeds file size limit",
    },
  ])(
    "a $case file's message lands in a polite live region that describes the input, after the hint",
    async ({ file, message }) => {
      const screen = await render(<CaptionedEditor />);
      const input = screen.getByLabelText("Banner", { exact: true });
      const el = input.element() as HTMLInputElement;

      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(el, "files", { value: dt.files });
      el.dispatchEvent(new Event("change", { bubbles: true }));

      const region = screen.getByText(message, { exact: true });
      await expect.element(region).toHaveAttribute("aria-live", "polite");
      await expect.element(input).toHaveAttribute("aria-invalid", "true");
      const [hint_id, error_id] = (
        el.getAttribute("aria-describedby") ?? ""
      ).split(" ");
      expect(document.getElementById(hint_id)?.textContent).toMatch(
        /JPEG, PNG/
      );
      expect(error_id).toBe(region.element().id);
    }
  );

  test("a hint renders under the dropzone and describes the input; none is drawn without one", async () => {
    const hint = "Shown at 4:1 — wider images crop to fit.";
    const screen = await render(
      <>
        <label htmlFor="banner">Banner</label>
        <ImgEditor id="banner" hint={hint} {...make_props()} />
      </>
    );
    const input = screen.getByLabelText("Banner", { exact: true });

    await expect.element(screen.getByText(hint, { exact: true })).toBeVisible();
    await expect.element(input).toHaveAccessibleDescription(/JPEG, PNG/);
    await expect
      .element(input)
      .toHaveAccessibleDescription(/wider images crop to fit\.$/);

    await cleanup();
    const bare = await render_editor(make_props());
    expect(bare.getByText(hint, { exact: true }).query()).toBeNull();
  });

  test("the live region is mounted before any error, so its first message is a change", async () => {
    const screen = await render(<CaptionedEditor />);
    const live = screen.container.querySelectorAll("[aria-live='polite']");
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe("");
  });
});
