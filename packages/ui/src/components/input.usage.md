# input

Registry item `input` (files: `components/form/input.tsx`, `field.tsx`, `label.tsx`, `types.ts`, `helpers/unpack.ts`). Needs the `tokens` item, `react` and `lucide-react`.

## API

- `Field` (`./components/form/field`): label, optional help text, control and error as one unit.
  - `label` (required, string or element), `action` (a button or buttons beside the control), `name` (required in practice: ids derive from it), `type` (any input type, or `"textarea"`), `sub` (help text under the label), `tooltip` (text under the control), `error` (message), `required`, `describedby` (ids of help text rendered outside), `classes`, `ref`, and the native input or textarea props.
  - `required` only draws the marker and sets `aria-required`; native `required` is withheld so your own validation runs and reports the error.
  - `type="email" | "url" | "tel"` render as text with `inputMode`, so the browser does not block submit in its own bubble.
  - `autoComplete` defaults to `"off"`; pass a token to opt in.
- `Input`: the bare control with an optional `icon` and `error`, for custom layouts.
- `Label`: `required` true draws a marker, false draws "(optional)", undefined draws nothing.
- `classes` is a string (container) or `{ input, container, label, error }`.

## Errors stay with their input

An error sits directly under the input it belongs to, inside that input's column, aligned to the input's start edge. When a field shares a row with buttons, the row holds only the input and the buttons; the error and the hint go under the input, never under the row.

A field with a button beside it takes the button as `action`. Inside the field the row is `[control][action]`: the label stays above, and the error and the `tooltip` text render in the control's column, under the input, starting at its start edge. Give each button `size="field"` (`btn-field`) so it keeps the control's height. When the field is under 384px wide (its own width, not the viewport's, so a field in any container that narrow wraps too, and a dialog or a form column wider than that does not) the action wraps under the control. The row takes its width from its parent, never its content: inside a shrink-to-fit parent such as an auto-width flex item, give the field a width.

```tsx
<Field
  label="Paste a link"
  name="link"
  type="url"
  error={errors.link}
  action={<Button variant="primary" size="field" onClick={add}>Add</Button>}
/>
```

Pass the buttons as `action`; a row built by hand around a `Field` puts its error under the whole row. `.field-err` is `text-align: start`, so the message begins at the input's start edge whatever the direction of the page.

## Accessibility

- The label is associated by `htmlFor`; help text and the error are listed in `aria-describedby`, and `aria-errormessage` and `aria-invalid` follow `error`.
- The error never replaces the help text for assistive technology: both are read.
- `action` changes the layout only. The error is still in the input's `aria-describedby` and `aria-errormessage`.

Read-only (`readOnly`) shows the disabled fill and ink but stays selectable and copyable, with focus and a text cursor; only its hover edge is withheld. `disabled` and `aria-disabled="true"` are inert.

## The browser's invalid look

`.field-input` also draws the destructive edge on `:user-invalid`: the browser's own check of the native constraints (`step`, `min`, `max`, `pattern`, `maxLength`), which applies once the user has changed the value and left the field, so an untouched field is not red on first paint. A field whose constraint is not its rule opts out with `data-manual-invalid` on the input; it then never takes the invalid look from `:user-invalid`, and hover still darkens its edge. `aria-invalid="true"` still wins: `error` sets it, and the field shows the destructive edge as before. The same attribute works on an input inside `.field-input-container`.

The attribute changes the look only. The browser still checks the constraint when the form submits: a `step="0.01"` field holding `10.555` blocks the submit in the browser's own bubble, and your check never runs. So a field whose own rule replaces a native constraint drops that constraint, or the form takes `noValidate`. A money field that rounds a third decimal takes `step="any"` with `inputMode="decimal"`, so nothing native refuses the value, and passes `error` when its own check fails:

```tsx
<Field label="Amount" name="amount" type="number" step="any" inputMode="decimal" data-manual-invalid="" error={errors.amount} />
```

## Theming

The control uses `--surface`, `--input` and `--input-hover` for fill and edge, `--ring` for focus and `--destructive-subtle-fg` for the error text and the required asterisk (`.field-err`, the line beside a `tooltip`, the label markers; `--destructive` is a fill and reads too faint as ink on the dark page). Its height is `--field-size`, shared with `btn-field`. All of these are roles over scale steps, so a theme or `.dark` recolors the field.
