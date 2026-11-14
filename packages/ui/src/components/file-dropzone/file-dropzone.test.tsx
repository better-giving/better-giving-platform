import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { FileDropzone } from "./file-dropzone";
import type { FileOutput, FileSpec } from "./types";

const upload_mock = vi.fn<(f: File) => Promise<string>>();
const report_error_mock = vi.fn<(err: unknown) => void>();

const specs: FileSpec = {
  mbLimit: 6,
  mimeTypes: ["image/jpeg", "image/png", "application/pdf"],
};

/** the shape every call site uses: `value` is state the parent owns, so the
 * live region and the drop area actually advance through the machine's states */
function Controlled() {
  const [value, set_value] = useState<FileOutput>("");
  return (
    <FileDropzone
      dropzone_name="Supporting document"
      value={value}
      onChange={set_value}
      specs={specs}
      upload={upload_mock}
      report_error={report_error_mock}
    />
  );
}

/** dispatches the same statement.pdf at the dropzone's file input on every call */
function picker(container: HTMLElement) {
  const input = container.querySelector(
    "input[type='file']"
  ) as HTMLInputElement;
  const file = new File(["pdf"], "statement.pdf", {
    type: "application/pdf",
  });
  return () => {
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", {
      value: dt.files,
      configurable: true,
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // restoreAllMocks does not reset a bare vi.fn(); without this the rejecting
  // impl set in the failure test leaks into whatever runs next.
  upload_mock.mockReset();
  report_error_mock.mockReset();
});

describe("FileDropzone", () => {
  test("renders upload prompt and valid types", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    await expect.element(screen.getByText(/upload file/i)).toBeVisible();
    await expect
      .element(screen.getByText(/click to browse or drag & drop/i))
      .toBeVisible();
    await expect.element(screen.getByText(/JPEG, PNG, PDF/)).toBeVisible();
    await expect.element(screen.getByText(/less than 6 MB/)).toBeVisible();
  });

  test("shows loading state when value is 'loading'", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value="loading"
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    // loading spinner visible, upload prompt hidden
    await expect
      .element(screen.getByText(/upload file/i))
      .not.toBeInTheDocument();
  });

  test("shows the file name in the drop area and links to it outside", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value="https://example.com/annual%20report.pdf"
        view_href={(v) => `/docs?ref=${encodeURIComponent(v)}`}
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const dropzone = screen.container.querySelector("[data-part='dropzone']");
    // the drop area shows the decoded name, not the whole url
    expect(dropzone).toMatchTextContent("annual report.pdf");
    expect(dropzone).not.toMatchTextContent("https://");

    const link = screen.container.querySelector(
      "a[href='/docs?ref=https%3A%2F%2Fexample.com%2Fannual%2520report.pdf']"
    );
    expect(link).not.toBeNull();
    expect(link).toMatchTextContent("View uploaded file");
    // the whole point: a focusable link may not sit inside a role="button"
    expect(dropzone?.contains(link!)).toBe(false);
  });

  test("renders the upload prompt while a form controller's value is still undefined", async () => {
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value={undefined}
        onChange={vi.fn()}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );
    await expect.element(screen.getByText("Upload file")).toBeVisible();
    expect(screen.container.querySelector("a")).toBeNull();
  });

  test("never links the raw stored value: no view_href, no link", async () => {
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value="https://example.com/a.pdf"
        onChange={vi.fn()}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );
    const dropzone = screen.container.querySelector("[data-part='dropzone']");
    expect(dropzone).toMatchTextContent("a.pdf");
    expect(screen.container.querySelector("a")).toBeNull();
  });

  test("drops the picked file's name once the value resets", async () => {
    function Resettable() {
      const [value, set_value] = useState<FileOutput>("");
      return (
        <>
          <FileDropzone
            dropzone_name="Supporting document"
            value={value}
            onChange={set_value}
            specs={specs}
            upload={upload_mock}
            report_error={report_error_mock}
          />
          <button type="button" onClick={() => set_value("")}>
            Reset
          </button>
        </>
      );
    }
    upload_mock.mockResolvedValue("https://example.com/statement.pdf");
    const screen = await render(<Resettable />);
    const dropzone = () =>
      screen.container.querySelector("[data-part='dropzone']");

    picker(screen.container)();
    await vi.waitFor(() =>
      expect(dropzone()).toMatchTextContent("statement.pdf")
    );

    await screen.getByRole("button", { name: "Reset" }).click();
    await vi.waitFor(() =>
      expect(dropzone()).toMatchTextContent("Upload file")
    );
    expect(dropzone()).not.toMatchTextContent("statement.pdf");
  });

  test("shows error message when error prop is set", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
        error="required"
      />
    );

    await expect.element(screen.getByText("required")).toBeVisible();
  });

  test("rejects invalid file type", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const bad_file = new File(["data"], "file.txt", {
      type: "text/plain",
    });

    // simulate drop via native input change
    const dt = new DataTransfer();
    dt.items.add(bad_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith("invalid-type")
    );
  });

  test("rejects file exceeding size limit", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    // 7MB file exceeds 6MB limit
    const big_file = new File([new ArrayBuffer(7e6)], "big.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(big_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith("exceeds-size")
    );
  });

  test("uploads valid file and calls onChange with URL", async () => {
    upload_mock.mockResolvedValue("https://cdn.example.com/uploaded.png");
    const on_change = vi.fn();

    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const valid_file = new File(["img"], "photo.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(valid_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => expect(on_change).toHaveBeenCalledWith("loading"));

    await vi.waitFor(() =>
      expect(on_change).toHaveBeenCalledWith(
        "https://cdn.example.com/uploaded.png"
      )
    );
  });

  test("calls onChange('failure') when upload fails", async () => {
    upload_mock.mockRejectedValue(new Error("network error"));
    const on_change = vi.fn();

    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;

    const valid_file = new File(["img"], "photo.png", {
      type: "image/png",
    });

    const dt = new DataTransfer();
    dt.items.add(valid_file);
    Object.defineProperty(input, "files", { value: dt.files });
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => expect(on_change).toHaveBeenCalledWith("failure"));
  });

  test("stays focusable and reports busy while uploading", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value="loading"
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const dropzone = screen.container.querySelector("[data-part='dropzone']");
    // uploading is busy, not disabled: routing it through zag's `disabled`
    // stripped tabIndex mid-interaction and dropped focus to <body>
    expect(dropzone?.getAttribute("tabindex")).toBe("0");
    expect(dropzone?.getAttribute("aria-busy")).toBe("true");
    expect(dropzone?.hasAttribute("data-disabled")).toBe(false);
  });

  test("announces a rejection and an upload in the live region", async () => {
    upload_mock.mockResolvedValue("https://cdn.example.com/uploaded.png");
    const screen = await render(<Controlled />);

    const status = () => screen.container.querySelector("[role='status']");
    // always mounted, empty until there is something to say — an element
    // inserted at the same moment as its text is announced unreliably
    expect(status()).not.toBeNull();
    expect(status()).toMatchTextContent("");

    const input = screen.container.querySelector(
      "input[type='file']"
    ) as HTMLInputElement;
    const put = (f: File) => {
      const dt = new DataTransfer();
      dt.items.add(f);
      Object.defineProperty(input, "files", {
        value: dt.files,
        configurable: true,
      });
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    put(new File(["data"], "notes.txt", { type: "text/plain" }));
    await vi.waitFor(() =>
      expect(status()).toMatchTextContent(
        "Rejected notes.txt: not an accepted file type"
      )
    );

    put(new File(["img"], "photo.png", { type: "image/png" }));
    await vi.waitFor(() =>
      expect(status()).toMatchTextContent("Uploaded photo.png")
    );
  });

  test("re-picking the same file after a failed upload retries it, and again after that", async () => {
    upload_mock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue("https://cdn.example.com/statement.pdf");
    const screen = await render(<Controlled />);

    const status = () => screen.container.querySelector("[role='status']");
    const put = picker(screen.container);

    put();
    await vi.waitFor(() =>
      expect(status()).toMatchTextContent("Upload failed for statement.pdf")
    );

    put();
    await vi.waitFor(() =>
      expect(status()).toMatchTextContent("Uploaded statement.pdf")
    );
    expect(upload_mock).toHaveBeenCalledTimes(2);

    put();
    await vi.waitFor(() => expect(upload_mock).toHaveBeenCalledTimes(3));
  });

  // three picks, not two: zag fires a FILE_EXISTS rejection only when it differs
  // from the previous one, so a held file lets the second pick through and
  // swallows the third
  test("picking the same file three times uploads it three times", async () => {
    upload_mock.mockResolvedValue("https://cdn.example.com/statement.pdf");
    const screen = await render(<Controlled />);

    const status = () => screen.container.querySelector("[role='status']");
    const put = picker(screen.container);

    for (const n of [1, 2, 3]) {
      put();
      await vi.waitFor(() => expect(upload_mock).toHaveBeenCalledTimes(n));
      await vi.waitFor(() =>
        expect(status()).toMatchTextContent("Uploaded statement.pdf")
      );
    }
  });

  test("renders each error code as text, never as a link", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value="invalid-type"
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
    );

    const dropzone = screen.container.querySelector("[data-part='dropzone']");
    expect(dropzone).toMatchTextContent("Not an accepted file type");
    // the codes must not fall through to the url branch: href="invalid-type"
    expect(screen.container.querySelector("a")).toBeNull();
  });

  test("disabled state prevents interaction", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={on_change}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
        disabled={true}
      />
    );

    await vi.waitFor(() => {
      const dropzone = screen.container.querySelector("[data-disabled]");
      expect(dropzone).not.toBeNull();
    });
  });
});

/** the shape the bank-details and fsa steps use: a controller-driven dropzone
 * whose rule fails on an empty value, so a submit exercises RHF's default
 * focus-on-error rather than an explicit `setFocus` */
function RHFHarness() {
  const { control, handleSubmit } = useForm<{ bankStatement: FileOutput }>({
    defaultValues: { bankStatement: "" },
  });
  const { field } = useController({
    control,
    name: "bankStatement",
    rules: { validate: (v) => !!v || "required" },
  });

  return (
    <form onSubmit={handleSubmit(() => {})}>
      <FileDropzone
        ref={field.ref}
        dropzone_name="Bank statement"
        value={field.value}
        onChange={field.onChange}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe("FileDropzone: focus target", () => {
  test("failed submit focuses a control with an accessible name", async () => {
    const screen = await render(<RHFHarness />);

    await screen.getByRole("button", { name: /submit/i }).click();

    await vi.waitFor(() => {
      const active = document.activeElement;
      expect(active?.getAttribute("data-part")).toBe("dropzone");
      expect(active?.getAttribute("role")).toBe("button");
      expect(active?.getAttribute("aria-label")).toBe("Bank statement");
    });
  });

  test("points the control at its error text", async () => {
    const screen = await render(
      <FileDropzone
        dropzone_name="Supporting document"
        value=""
        onChange={() => {}}
        specs={specs}
        upload={upload_mock}
        report_error={report_error_mock}
        error="required"
      />
    );

    const dropzone = screen.container.querySelector("[data-part='dropzone']");
    const err_id = dropzone?.getAttribute("aria-describedby");
    expect(err_id).toBeTruthy();

    expect(
      screen.container.querySelector(`#${CSS.escape(err_id!)}`)
    ).toMatchTextContent("required");
  });
});
