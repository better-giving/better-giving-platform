# input

Registry item `input` (files: `components/form/input.tsx`, `field.tsx`, `label.tsx`, `types.ts`, `helpers/unpack.ts`). Needs the `tokens` item, `react` and `lucide-react`.

## API

- `Field` (`./components/form/field`): label, optional help text, control and error as one unit.
  - `label` (required, string or element), `name` (required in practice: ids derive from it), `type` (any input type, or `"textarea"`), `sub` (help text under the label), `tooltip` (text under the control), `error` (message), `required`, `describedby` (ids of help text rendered outside), `classes`, `ref`, and the native input or textarea props.
  - `required` only draws the marker and sets `aria-required`; native `required` is withheld so your own validation runs and reports the error.
  - `type="email" | "url" | "tel"` render as text with `inputMode`, so the browser does not block submit in its own bubble.
  - `autoComplete` defaults to `"off"`; pass a token to opt in.
- `Input`: the bare control with an optional `icon` and `error`, for custom layouts.
- `Label`: `required` true draws a marker, false draws "(optional)", undefined draws nothing.
- `classes` is a string (container) or `{ input, container, label, error }`.

## Accessibility

- The label is associated by `htmlFor`; help text and the error are listed in `aria-describedby`, and `aria-errormessage` and `aria-invalid` follow `error`.
- The error never replaces the help text for assistive technology: both are read.

## Theming

The control uses `--surface`, `--input` and `--input-hover` for fill and edge, `--ring` for focus and `--destructive-subtle-fg` for the error text and the required asterisk (`.field-err`, the line beside a `tooltip`, the label markers; `--destructive` is a fill and reads too faint as ink on the dark page). Its height is `--field-size`, shared with `btn-field`. All of these are roles over scale steps, so a theme or `.dark` recolors the field.
