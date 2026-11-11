import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Field } from "./field";

describe("Field: autofill", () => {
  it("defaults to off — the visitor's saved values must not prefill somebody else's data", async () => {
    const screen = await render(
      <Field label="Organization name" name="npo_name" />
    );
    const input = screen.getByLabelText("Organization name");

    await expect.element(input).toHaveAttribute("autocomplete", "off");
  });

  it("passes a named token through, so a field can opt into autofill", async () => {
    const screen = await render(
      <Field
        label="Your employer"
        name="company_name"
        autoComplete="organization"
      />
    );
    const input = screen.getByLabelText("Your employer");

    await expect.element(input).toHaveAttribute("autocomplete", "organization");
  });

  it("applies to a textarea too", async () => {
    const screen = await render(
      <Field label="Notes" name="notes" type="textarea" autoComplete="off" />
    );

    await expect
      .element(screen.getByLabelText("Notes"))
      .toHaveAttribute("autocomplete", "off");
  });
});

describe("Field: native validation", () => {
  it("renders a constrained text type as text, so the browser cannot block the submit in its own bubble", async () => {
    const screen = await render(
      <Field label="Work email" name="email" type="email" />
    );
    const input = screen.getByLabelText("Work email");

    await expect.element(input).toHaveAttribute("type", "text");
    await expect.element(input).toHaveAttribute("inputmode", "email");
    await expect.element(input).toHaveAttribute("autocapitalize", "none");
  });

  it("keeps a caller's own inputMode", async () => {
    const screen = await render(
      <Field label="Phone" name="phone" type="tel" inputMode="numeric" />
    );

    await expect
      .element(screen.getByLabelText("Phone"))
      .toHaveAttribute("inputmode", "numeric");
  });

  it("leaves a control type alone — date is the control, not a rule over free text", async () => {
    const screen = await render(
      <Field label="Start date" name="start" type="date" />
    );

    await expect
      .element(screen.getByLabelText("Start date"))
      .toHaveAttribute("type", "date");
  });

  it("withholds required from the control, and marks it on the label instead", async () => {
    const screen = await render(
      <Field label="Nonprofit name" name="o_name" required />
    );

    await expect
      .element(screen.getByLabelText("Nonprofit name"))
      .not.toHaveAttribute("required");
  });
});

describe("Field: error announcement", () => {
  // `aria-errormessage` is the right relationship and several screen readers
  // ignore it, so the description is what actually reaches the reader.
  it("names the message as the input's description", async () => {
    const screen = await render(
      <Field label="Work email" name="email" error="Enter a valid address" />
    );

    await expect
      .element(screen.getByLabelText("Work email"))
      .toHaveAccessibleDescription("Enter a valid address");
  });

  // conditional, so a valid field is not described by its own empty paragraph
  it("describes nothing when there is no error", async () => {
    const screen = await render(<Field label="Work email" name="email" />);

    await expect
      .element(screen.getByLabelText("Work email"))
      .toHaveAccessibleDescription("");
  });
});

describe("Field: required announcement", () => {
  it("announces requiredness the control's own attribute cannot", async () => {
    const screen = await render(
      <Field label="Nonprofit name" name="o_name" required />
    );

    await expect
      .element(screen.getByLabelText("Nonprofit name"))
      .toHaveAttribute("aria-required", "true");
  });

  it("leaves an optional field unmarked", async () => {
    const screen = await render(<Field label="Address" name="street" />);

    await expect
      .element(screen.getByLabelText("Address"))
      .not.toHaveAttribute("aria-required");
  });
});

describe("Field: help text announcement", () => {
  it("describes the control by its sub note", async () => {
    const screen = await render(
      <Field
        label="Work email"
        name="email"
        sub="We'll send your donation receipt to this email."
      />
    );

    await expect
      .element(screen.getByLabelText("Work email"))
      .toHaveAccessibleDescription(
        "We'll send your donation receipt to this email."
      );
  });

  it("describes the control by a sub note passed as markup", async () => {
    const screen = await render(
      <Field
        label="Redirect URL"
        name="redirect_url"
        sub={
          <p>
            The URL to redirect to after a successful donation, with{" "}
            <code>donor_name</code> appended.
          </p>
        }
      />
    );

    await expect
      .element(screen.getByLabelText("Redirect URL"))
      .toHaveAccessibleDescription(
        "The URL to redirect to after a successful donation, with donor_name appended."
      );
  });

  it("describes the control by its tooltip", async () => {
    const screen = await render(
      <Field
        label="EIN"
        name="ein"
        tooltip="The 9-digit number the IRS issued to your organization."
      />
    );

    await expect
      .element(screen.getByLabelText("EIN"))
      .toHaveAccessibleDescription(
        "The 9-digit number the IRS issued to your organization."
      );
  });

  it("takes a caller's own id, for help text this component did not render", async () => {
    const screen = await render(
      <>
        <p id="outside_note">Only numbers and letters are permitted.</p>
        <Field label="Custom URL" name="slug" describedby="outside_note" />
      </>
    );

    await expect
      .element(screen.getByLabelText("Custom URL"))
      .toHaveAccessibleDescription("Only numbers and letters are permitted.");
  });

  it("adds the error to the list rather than replacing it", async () => {
    const screen = await render(
      <Field
        label="Work email"
        name="email"
        sub="We'll send your donation receipt to this email."
        error="Enter a valid address"
      />
    );
    const input = screen.getByLabelText("Work email").element();

    expect(input.getAttribute("aria-describedby")).toBe(
      "__sub_email __error_email"
    );
  });

  it("lists every id in reading order, whatever shape the sub note is", async () => {
    const screen = await render(
      <>
        <p id="outside_note">Only numbers and letters are permitted.</p>
        <Field
          label="Custom URL"
          name="slug"
          sub={<p>Your page lives at better.giving/&#123;slug&#125;.</p>}
          tooltip="Lowercase only."
          describedby="outside_note"
          error="Already taken"
        />
      </>
    );
    const input = screen.getByLabelText("Custom URL").element();

    expect(input.getAttribute("aria-describedby")).toBe(
      "__sub_slug __tooltip_slug outside_note __error_slug"
    );
  });

  it("describes nothing when there is no help text and no error", async () => {
    const screen = await render(<Field label="Address" name="street" />);
    const input = screen.getByLabelText("Address").element();

    expect(input.getAttribute("aria-describedby")).toBe(null);
  });

  it("keeps sub off the control — it is the note's text, not an attribute", async () => {
    const screen = await render(
      <Field
        label="Work email"
        name="email"
        sub="We'll send your donation receipt to this email."
      />
    );
    const input = screen.getByLabelText("Work email").element();

    expect(input.hasAttribute("sub")).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe("__sub_email");
  });

  it("treats a whitespace-only sub as absent: no note, nothing described", async () => {
    const screen = await render(
      <Field label="Address" name="street" sub="   " />
    );
    const input = screen.getByLabelText("Address").element();

    expect(input.getAttribute("aria-describedby")).toBe(null);
    expect(document.getElementById("__sub_street")).toBe(null);
  });
});

describe("Field: action", () => {
  it("renders the action beside the control, in the same row", async () => {
    const screen = await render(
      <Field
        label="Custom URL"
        name="slug"
        action={<button type="button">Check</button>}
      />
    );
    const input = screen.getByLabelText("Custom URL").element();
    const button = screen.getByRole("button", { name: "Check" }).element();

    const row = input.closest(".field-row");
    expect(row).not.toBe(null);
    expect(row?.contains(button)).toBe(true);
    const a = input.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    expect(b.left).toBeGreaterThanOrEqual(a.right);
  });

  it("keeps the error and the tooltip under the control, not under the row", async () => {
    const screen = await render(
      <Field
        label="Custom URL"
        name="slug"
        tooltip="Lowercase only."
        error="Already taken"
        action={<button type="button">Check</button>}
      />
    );
    const control = screen.getByLabelText("Custom URL").element();
    const column = control.closest(".field-control");

    expect(column?.contains(document.getElementById("__tooltip_slug"))).toBe(
      true
    );
    expect(column?.contains(document.getElementById("__error_slug"))).toBe(
      true
    );
    expect(
      column?.contains(screen.getByRole("button", { name: "Check" }).element())
    ).toBe(false);
  });

  it("keeps the error under the control when there is no tooltip", async () => {
    const screen = await render(
      <Field
        label="Custom URL"
        name="slug"
        error="Already taken"
        action={<button type="button">Check</button>}
      />
    );
    const column = screen
      .getByLabelText("Custom URL")
      .element()
      .closest(".field-control");

    expect(column?.contains(document.getElementById("__error_slug"))).toBe(
      true
    );
  });

  it("still describes the control by ids that exist, with an action present", async () => {
    const screen = await render(
      <>
        <p id="outside_note">Only numbers and letters are permitted.</p>
        <Field
          label="Custom URL"
          name="slug"
          sub="Your page address."
          tooltip="Lowercase only."
          describedby="outside_note"
          error="Already taken"
          action={<button type="button">Check</button>}
        />
      </>
    );
    const input = screen.getByLabelText("Custom URL").element();
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");

    expect(ids).toEqual([
      "__sub_slug",
      "__tooltip_slug",
      "outside_note",
      "__error_slug",
    ]);
    for (const id of ids) expect(document.getElementById(id)).not.toBe(null);
    await expect
      .element(input)
      .toHaveAccessibleDescription(
        "Your page address. Lowercase only. Only numbers and letters are permitted. (Already taken)"
      );
  });

  it("adds no row when there is no action", async () => {
    const screen = await render(
      <Field label="Custom URL" name="slug" error="Already taken" />
    );
    const input = screen.getByLabelText("Custom URL").element();

    expect(input.closest(".field-row")).toBe(null);
    expect(input.closest(".field-control")).toBe(null);
    expect(document.querySelector(".field-action")).toBe(null);
    expect(input.getAttribute("aria-describedby")).toBe("__error_slug");
  });
});
