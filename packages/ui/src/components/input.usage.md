# input

Registry item `input` (files: `components/form/input.tsx`, `field.tsx`, `label.tsx`, `block-note.tsx`, `types.ts`, `helpers/unpack.ts`). Needs the `tokens` item, `react` and `lucide-react`.

## API

- `Field` (`./components/form/field`): label, optional help text, control and error as one unit.
  - `label` (required, string or element), `action` (a button or buttons beside the control), `status` (what a button in `action` reports, see below), `name`, `type` (any input type, or `"textarea"`), `sub` (help text under the label), `tooltip` (the hint under the control), `error` (message), `warning` (a message that does not block), `mono` (a key, secret or id), `prefix` and `suffix` (a unit or sign inside the edge, see below), `limit`, `hard`, `count_label`, `over_message` and `limit_messages` (a character counter, see below), `id` (the control's own id), `required`, `describedby` (ids of help text rendered outside), `classes`, `ref`, and the native input or textarea props.
  - Ids are minted per field with `useId`, so two fields with the same `name` (a repeated row, the same form twice on a page) never share an id.
  - `id` names the control itself, for an error summary's link (`<a href="#work_email">`) or a `<label for>` outside the field; the help text keeps its minted ids and stays wired to the control. Without it the control's id is minted too, so a link to `#__<name>` resolves to nothing: pass `id`.
  - `required` only draws the marker and sets `aria-required`; native `required` is withheld so your own validation runs and reports the error.
  - `type="textarea"` renders the control as a block, so the field ends at the textarea's bottom edge and the message sits 4px under it, as under an input. The rule is `.field-input` in the `tokens` item (2.3.0 and later).
  - `type="email" | "url" | "tel"` render as text with `inputMode`, so the browser does not block submit in its own bubble.
  - `autoComplete` defaults to `"off"`; pass a token to opt in.
- `Input`: the bare control with an optional `icon` and `error`, for custom layouts.
- `Label`: `required` true draws a marker, false draws "(optional)", undefined draws nothing.
- `useDone({ done_ms = 2000 })` (`./components/form/field`): `[done, mark]` for a button's done state. Call `mark()` once the work succeeded; `done` is true for `done_ms`, then false again. A second `mark()` inside the window starts it over. `mark` keeps its identity across renders.
- `classes` is a string (container) or `{ input, container, label, error }`. `error` styles the error only, never the warning.

## Messages and the hint

One slot under the input holds at most one message, at the input's start edge: `error`, or `warning`. The hint (`tooltip`) goes under the message, never beside it.

- `error`: destructive ink, the destructive edge, `aria-invalid="true"` and `aria-errormessage`.
- `warning`: a note that does not block (a value that differs from a record, a link that was used before). Warning ink and a warning mark, the edge unchanged, never `aria-invalid`; it never stops a submit. Give both and the error wins: the warning does not render. An empty string counts as absent. The warning's paragraph is a polite live region that is in the page, rendered and taking no room, before its text, so a warning that appears while the user types is read out.
- `tooltip`: the hint under the control, small and muted, under the message when one shows.

```tsx
<Field label="Display name" name="display_name" warning={differs ? "Differs from your registered name." : ""} />
<Field label="Campaign link" name="slug" tooltip="Letters, numbers and dashes. It ends your public link." error={errors.slug} />
```

## A note for a whole block

`BlockNote` (`./components/form/block-note`) is one plain line of help for a whole block or card rather than one field ("3 more settings can be changed in the chat"), or an error about the whole section. It is the field hint's styling used above field level, so it lives with the field, not the card: it takes the `field-help` class, so its size, ink and line height are the hint's and follow it.

- `children`: the text; for an error, nothing while there is none.
- `tone`: `"help"` (default), `--gray-11` ink and no role; `"error"`, the field error's `--destructive-subtle-fg` ink at the same size, in a polite live region (`role="status"`, with `aria-live="polite"` and `aria-atomic="true"` beside it, which `role="status"` implies but older screen readers need written out). Keep the error note mounted, empty, from the start: empty it stays in the page with no height and no margin. It takes no room in a block of its own, but inside a flex or grid container with a `gap` it is still an item, so its container draws a gap beside it: leave the gap off that container, or place the note where there is none. It writes its text a frame after the text changes, so an error there when the page loads is announced, and so is a new one. To say the same error again (a second failed save), clear it first, then set it: the clear has to render before the error is set again, as a clear batched into the same update as the new error does nothing.
- Point the control the error is about at it: `aria-describedby` on the Save button names the note, so the button carries the error with it.
- `id`: lets the card name the help as its description, `aria-describedby` on the card's root.
- `classes`: appended last. The note carries no outer spacing (the hint's 4px top margin is taken off); its place in the block is yours.

Keep a field's own error and hint on the field (`error`, `tooltip`); a note is for what belongs to no single field.

```tsx
<Card aria-labelledby="alerts-title" aria-describedby="alerts-note">
  <form id="alerts" onSubmit={save}>
    <CardBody>
      <h2 id="alerts-title">Alerts</h2>
      ...
      <BlockNote id="alerts-note" classes="mbs-4">3 more settings can be changed in the chat.</BlockNote>
    </CardBody>
  </form>
</Card>
<Button type="submit" form="alerts" aria-describedby="alerts-error">Save changes</Button>
<BlockNote id="alerts-error" tone="error">{failed ? "These settings could not be saved. Try again." : null}</BlockNote>
```

## Errors stay with their input

An error sits directly under the input it belongs to, inside that input's column, aligned to the input's start edge. When a field shares a row with buttons, the row holds only the input and the buttons; the error and the hint go under the input, never under the row.

A field with a button beside it takes the button as `action`. Inside the field the row is `[control][action]`: the label stays above, and the error and the `tooltip` text render in the control's column, under the input, starting at its start edge. Give each button `size="field"` (`btn-field`) so it keeps the control's height. When the field is under 384px wide (its own width, not the viewport's, so a field in any container that narrow wraps too, and a dialog or a form column wider than that does not) the action wraps under the control. Two or more buttons need more room, so they wrap under the input when the field is under 576px (36rem), start-aligned and in DOM order; when the field is narrower than the buttons themselves they wrap among themselves, the second on its own line. The message and the hint stay in the control's column, above the buttons. The row takes its width from its parent, never its content: inside a shrink-to-fit parent such as an auto-width flex item, give the field a width.

```tsx
<Field
  label="Paste a link"
  name="link"
  type="url"
  error={errors.link}
  action={<Button variant="primary" size="field" onClick={add}>Add</Button>}
/>
```

## A prefix or a suffix

`prefix` puts a sign or unit before the value inside the control's edge (`"$"`), `suffix` after it (`"days"`, `"%"`); both at once is fine (`"$"` and `"USD"`). The control becomes a `.field-input-container` row, at least `--field-size` tall, with the affix 16px in from the edge in gray-11, and the input's inset on the affix's side drops from 16px to 4px. The edge, the fill, hover, the house ring, the destructive edge of `error`, and the read-only and disabled looks all move to the container; the input inside draws none of them. `classes.input` goes on the container.

The affix is `aria-hidden` and not selectable, so a copied value has no sign in it. A press on it focuses the input, as a press on the label does. Say the unit in the label or the hint, where it is read: "Goal (US dollars)", "End in (days)". Single-line controls only: a textarea ignores both props.

```tsx
<Field label="Goal (US dollars)" name="goal" inputMode="decimal" prefix="$" error={errors.goal} />
<Field label="End in (days)" name="days" inputMode="numeric" suffix="days" />
```

## A character counter

`limit` puts a counter at the end of the message slot: the slot becomes one row, the message at the start taking the free width, the counter at the end, `text-xs` gray-11 with tabular figures, "612 of 1,500". A single-line field uses the same slot ("34 of 80"). It counts a controlled `value`, or what is typed into an uncontrolled field from its `defaultValue`; your `onChange` still runs. An uncontrolled count follows its form's `reset` (a reset button or `form.reset()`), back to the default value; a controlled one follows your `value`.

- Near, from 90% of the limit: the counter takes `--warning-subtle-fg`. Nothing else changes.
- Over: `--destructive-subtle-fg` at weight 600 and "1,512 of 1,500 · 12 over"; the control takes `aria-invalid="true"` and the destructive edge, and the message slot names the overage, "12 characters over the limit.", unless you pass an `error`, which wins. `over_message(over)` replaces the default line; `count_label(count, limit)` the counter's text.
- Soft by default: there is no `maxlength`, so a paste over the limit keeps every character and the reader decides what to cut. `hard` adds `maxlength={limit}` for a field whose store cannot take more.
- The counter is `aria-hidden`. A `role="status"` region after the slot is mounted, empty, with the field, and speaks only when the count crosses a threshold, a second after the typing stops: "88 characters left" on reaching 90%, "12 characters over the limit" past the limit, "Within the limit" on coming back under it. It says nothing on mount and nothing for each keystroke. `limit_messages` (`{ near(left), over(over), within }`) replaces any of the three.

```tsx
<Field label="Your story" name="story" type="textarea" rows={4} limit={1500} />
<Field label="Page title" name="title" limit={80} over_message={(n) => `The title is ${n} characters too long.`} />
```

## A key, secret or id

`mono` sets the mono face with ligatures off, so `0O` and `1l` read apart, and an ellipsis when the value overflows; the size stays the field's. Spellcheck, autocomplete and autocapitalize are off. Read-only keeps the muted fill but takes full ink, since the value is what the reader came for, and stays selectable and focusable.

A copy button goes in `action`, secondary at `size="field"`, with `is_done` (see the `button` item): the row reserves the width of its done label, so "Copied" does not shift the row, and the button puts the check before the done label itself. Pass `status` (`""` at rest) and the field renders a `role="status"` region after the buttons that reads the outcome out. `useDone` holds the done state for 2000ms (`done_ms` to change it):

```tsx
const [done, mark] = useDone();
<Field
  label="Publishable key"
  name="publishable_key"
  mono
  readOnly
  value={key}
  status={done ? "Copied to clipboard" : ""}
  action={
    <Button variant="secondary" size="field" is_done={done} onClick={() => navigator.clipboard.writeText(key).then(mark)}>
      {done ? "Copied" : <><Copy aria-hidden="true" />Copy</>}
    </Button>
  }
/>
```

A second button sits after it in the same `action`, for example a `destructive-outline` Regenerate with a `RefreshCw` mark that opens a confirm. The done look of a `[data-done="true"]` button is the button's own.

Pass the buttons as `action`; a row built by hand around a `Field` puts its error under the whole row. `.field-err` is `text-align: start`, so the message begins at the input's start edge whatever the direction of the page.

## Accessibility

- The label is associated by `htmlFor`; help text and the message are listed in `aria-describedby` in reading order (the sub under the label, the message, the hint, then your `describedby` ids), and `aria-errormessage` and `aria-invalid` follow `error`.
- A warning reads as "Warning: " and its text: the prefix is visually hidden, the mark is hidden from assistive technology.
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

The control uses `--surface`, `--input` and `--input-hover` for fill and edge, `--ring` for focus (the house ring: a 2px outline 2px out, on `:focus-visible`, which a text field matches on a click too; `.field-input-container` draws it when its input is focused) and `--destructive-subtle-fg` for the error text and the required asterisk (`.field-err`, the label markers; `--destructive` is a fill and reads too faint as ink on the dark page), `--warning-subtle-fg` for the warning (`.field-warn`) and the near counter, `--gray-11` for the hint (`.field-help`), and `--font-mono` with `--gray-12` for the mono box (`.field-input-mono`). Its height is `--field-size`, shared with `btn-field`. All of these are roles over scale steps, so a theme or `.dark` recolors the field.
